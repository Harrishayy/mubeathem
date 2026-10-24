import { timingSafeEqual } from 'node:crypto';
import {
  AddTurnRequest,
  CreateCallRequest,
  EndCallRequest,
  FeedbackRequest,
  SuggestionActionRequest,
  TrellusDispositionsRequest,
  TrellusKeyRequest,
  type ApiError,
} from '@cue/core';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import type { z } from 'zod';
import { originAllowed } from '../config';
import { AppError, type Cue } from '../services/cue';
import { StoreError } from '../store/events';
import { sttToken } from '../stt';
import { streamCall, StreamRegistry } from './sse';

const BODY_LIMIT = 64 * 1024;

function errorBody(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const text = await c.req.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AppError(400, 'invalid_json', 'Body is not valid JSON');
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError(400, 'invalid_request', 'Request body failed validation', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

function tokenOk(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The HTTP API in architecture.md §5. */
export function createApp(cue: Cue, registry: StreamRegistry = new StreamRegistry()): Hono {
  const { config } = cue.s;
  const app = new Hono();

  app.use('*', requestId());
  app.use(
    '*',
    cors({
      origin: (origin) => (origin && originAllowed(origin, config.allowedOrigins) ? origin : null),
      allowHeaders: ['content-type', 'x-cue-token', 'last-event-id', 'authorization', 'x-request-id'],
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      exposeHeaders: ['x-request-id'],
      maxAge: 600,
    }),
  );
  app.use('/api/*', async (c, next) => {
    if (!config.apiToken || c.req.method === 'OPTIONS') return next();
    const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    // EventSource can't set headers, so the stream (only) also takes ?token=.
    const query = c.req.path.endsWith('/stream') ? c.req.query('token') : undefined;
    if (tokenOk(c.req.header('x-cue-token') ?? bearer ?? query, config.apiToken)) return next();
    return c.json(errorBody('unauthorized', 'Missing or wrong x-cue-token'), 401);
  });
  app.use(
    '/api/*',
    bodyLimit({ maxSize: BODY_LIMIT, onError: (c) => c.json(errorBody('payload_too_large', `Body over ${BODY_LIMIT / 1024} KB`), 413) }),
  );

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json(errorBody(err.code, err.message, err.details), err.status);
    if (err instanceof StoreError) return c.json(errorBody(err.code, err.message), err.code === 'not_found' ? 404 : 409);
    if (err instanceof HTTPException) return c.json(errorBody('http_error', err.message), err.status);
    cue.s.log.error('unhandled', { path: c.req.path, message: err instanceof Error ? err.message : String(err) });
    return c.json(errorBody('internal', 'Something went wrong on the server'), 500);
  });
  app.notFound((c) => c.json(errorBody('not_found', `No route ${c.req.method} ${c.req.path}`), 404));

  app.get('/health', (c) => c.json(cue.health()));

  app.post('/api/calls', async (c) => c.json(cue.createCall(await parseBody(c, CreateCallRequest)), 201));
  app.get('/api/calls', (c) => {
    const n = Number(c.req.query('limit') ?? 50);
    return c.json(cue.s.store.summaries(Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : 50));
  });
  app.get('/api/calls/:id', (c) => c.json(cue.getCall(c.req.param('id'))));
  app.get('/api/calls/:id/stream', (c) => streamCall(c, cue, registry, config.heartbeatMs));
  app.post('/api/calls/:id/turns', async (c) => c.json(cue.addTurn(c.req.param('id'), await parseBody(c, AddTurnRequest)), 202));
  app.post('/api/calls/:id/suggestions/:sid/action', async (c) => {
    cue.suggestionAction(c.req.param('id'), c.req.param('sid'), await parseBody(c, SuggestionActionRequest));
    return c.body(null, 204);
  });
  app.post('/api/calls/:id/end', async (c) => c.json(cue.endCall(c.req.param('id'), await parseBody(c, EndCallRequest))));
  app.post('/api/calls/:id/feedback', async (c) => c.json(cue.feedback(c.req.param('id'), await parseBody(c, FeedbackRequest))));
  app.post('/api/calls/:id/practice/next', async (c) => {
    const { turn, ended, booked } = await cue.practiceNext(c.req.param('id'));
    return c.json({ turn, ended, booked });
  });
  app.get('/api/calls/:id/record', (c) => c.json(cue.record(c.req.param('id'))));

  app.get('/api/playbook', (c) => c.json(cue.playbook()));
  app.post('/api/playbook/lines/:id/approve', (c) => c.json(cue.setLineStatus(c.req.param('id'), 'active')));
  app.post('/api/playbook/lines/:id/reject', (c) => c.json(cue.setLineStatus(c.req.param('id'), 'rejected')));

  app.get('/api/stats', (c) => c.json(cue.stats()));
  app.get('/api/export.jsonl', (c) => {
    const n = Number(c.req.query('limit') ?? 500);
    const records = cue.exportRecords(Number.isFinite(n) ? Math.max(1, Math.min(5000, Math.floor(n))) : 500);
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        const next = records.next();
        if (next.done) ctrl.close();
        else ctrl.enqueue(enc.encode(JSON.stringify(next.value) + '\n'));
      },
    });
    return new Response(body, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'content-disposition': 'attachment; filename="cue-calls.jsonl"' } });
  });

  app.post('/api/stt/token', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await sttToken({ apiKey: config.stt.deepgramApiKey, ttlSeconds: config.stt.ttlSeconds, fetch: cue.s.fetch, now: cue.s.now }));
  });

  app.get('/api/trellus/dispositions', async (c) => c.json(await cue.trellus.dispositions()));
  app.put('/api/trellus/dispositions', async (c) => c.json(await cue.trellus.setOverrides((await parseBody(c, TrellusDispositionsRequest)).overrides)));

  app.get('/api/trellus/status', (c) => c.json(cue.trellus.status()));
  app.post('/api/trellus/sync', async (c) => {
    const { importedIds: _ids, ...result } = await cue.trellus.sync();
    return c.json(result);
  });
  app.post('/api/trellus/key', async (c) => {
    const req = await parseBody(c, TrellusKeyRequest);
    return c.json(cue.trellus.setKey(req.apiKey, req.teamId));
  });

  return app;
}
