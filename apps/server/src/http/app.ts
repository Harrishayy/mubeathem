import { timingSafeEqual } from 'node:crypto';
import {
  AddTurnRequest,
  CallListQuery,
  ContactImportRequest,
  ContactInput,
  ContactListQuery,
  CreateCallRequest,
  EndCallRequest,
  FeedbackRequest,
  PutBriefRequest,
  InsightsQuery,
  ResearchWarmRequest,
  SuggestionActionRequest,
  TeamQuery,
  TraceExportQuery,
  TraceListQuery,
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
import { EXPORT_FORMATS, exportFilename, exportTraces } from '../services/trace-export';
import { computeInsights } from '../store/insights';
import { ContactError } from '../store/contacts';
import { StoreError } from '../store/events';
import { sttToken } from '../stt';
import { streamCall, StreamRegistry } from './sse';

const BODY_LIMIT = 64 * 1024;
/** CSV contact imports are the one big body. */
const IMPORT_LIMIT = 2 * 1024 * 1024 + 4096;

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

function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw new AppError(400, 'invalid_request', 'Query failed validation', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

/** Streams text chunks from a generator, one pull at a time (back-pressure friendly). */
function streamText(chunks: Iterator<string>, headers: Record<string, string>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      try {
        const next = chunks.next();
        if (next.done) ctrl.close();
        else ctrl.enqueue(enc.encode(next.value));
      } catch (e) {
        ctrl.error(e);
      }
    },
  });
  return new Response(body, { headers });
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
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['x-request-id', 'x-total-count'],
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
  app.use('/api/*', (c, next) => {
    const max = c.req.path === '/api/contacts/import' ? IMPORT_LIMIT : BODY_LIMIT;
    return bodyLimit({ maxSize: max, onError: (c) => c.json(errorBody('payload_too_large', `Body over ${Math.floor(max / 1024)} KB`), 413) })(c, next);
  });

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json(errorBody(err.code, err.message, err.details), err.status);
    if (err instanceof ContactError) return c.json(errorBody(err.code, err.message), err.code === 'not_found' ? 404 : 409);
    if (err instanceof StoreError) return c.json(errorBody(err.code, err.message), err.code === 'not_found' ? 404 : 409);
    if (err instanceof HTTPException) return c.json(errorBody('http_error', err.message), err.status);
    cue.s.log.error('unhandled', { path: c.req.path, message: err instanceof Error ? err.message : String(err) });
    return c.json(errorBody('internal', 'Something went wrong on the server'), 500);
  });
  app.notFound((c) => c.json(errorBody('not_found', `No route ${c.req.method} ${c.req.path}`), 404));

  app.get('/health', (c) => c.json(cue.health()));

  app.post('/api/calls', async (c) => c.json(cue.createCall(await parseBody(c, CreateCallRequest)), 201));
  app.get('/api/calls', (c) => {
    const q = parseQuery(c, CallListQuery);
    c.header('x-total-count', String(cue.s.store.countSummaries(q)));
    return c.json(cue.s.store.summaries(q));
  });
  app.get('/api/calls/:id', (c) => c.json(cue.getCall(c.req.param('id'))));
  app.get('/api/calls/:id/stream', (c) => streamCall(c, cue, registry, config.heartbeatMs));
  app.post('/api/calls/:id/turns', async (c) => c.json(cue.addTurn(c.req.param('id'), await parseBody(c, AddTurnRequest)), 202));
  app.post('/api/calls/:id/suggestions/:sid/action', async (c) => {
    cue.suggestionAction(c.req.param('id'), c.req.param('sid'), await parseBody(c, SuggestionActionRequest));
    return c.body(null, 204);
  });
  app.put('/api/calls/:id/brief', async (c) => c.json(cue.putBrief(c.req.param('id'), await parseBody(c, PutBriefRequest))));
  app.post('/api/calls/:id/end', async (c) => c.json(cue.endCall(c.req.param('id'), await parseBody(c, EndCallRequest))));
  app.post('/api/calls/:id/feedback', async (c) => c.json(cue.feedback(c.req.param('id'), await parseBody(c, FeedbackRequest))));
  app.post('/api/calls/:id/practice/next', async (c) => {
    const { turn, ended, booked } = await cue.practiceNext(c.req.param('id'));
    return c.json({ turn, ended, booked });
  });
  app.get('/api/calls/:id/record', (c) => c.json(cue.record(c.req.param('id'))));

  /* The team: each rep's numbers, and the saved contacts everyone calls. */
  app.get('/api/team', (c) => c.json(cue.s.store.team(parseQuery(c, TeamQuery))));
  app.get('/api/contacts', (c) => c.json(cue.contacts.list(parseQuery(c, ContactListQuery))));
  app.post('/api/contacts', async (c) => c.json(cue.contacts.create(await parseBody(c, ContactInput)), 201));
  app.post('/api/contacts/import', async (c) => {
    const req = await parseBody(c, ContactImportRequest);
    return c.json(cue.contacts.importCsv(req.csv, req.ownerRepId));
  });
  app.get('/api/contacts/:id', (c) => {
    const ct = cue.contacts.get(c.req.param('id'));
    if (!ct) throw new AppError(404, 'not_found', `No contact ${c.req.param('id')}`);
    return c.json(ct);
  });
  app.put('/api/contacts/:id', async (c) => c.json(cue.contacts.update(c.req.param('id'), await parseBody(c, ContactInput))));
  app.delete('/api/contacts/:id', (c) => {
    if (!cue.contacts.remove(c.req.param('id'))) throw new AppError(404, 'not_found', `No contact ${c.req.param('id')}`);
    return c.body(null, 204);
  });

  app.post('/api/research/warm', async (c) => c.json(cue.warmResearch(await parseBody(c, ResearchWarmRequest)), 202));
  app.post('/api/research/brief', async (c) => c.json(await cue.researchBrief(await parseBody(c, ResearchWarmRequest))));

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

  /* Traces of every Mubit call and what worked (store/traces.ts, store/insights.ts). */
  app.get('/api/traces', (c) => c.json(cue.s.traces.list(parseQuery(c, TraceListQuery))));
  app.get('/api/traces/export', (c) => {
    const q = parseQuery(c, TraceExportQuery);
    const now = cue.s.now();
    return streamText(exportTraces(cue.s.traces, q, now), {
      'content-type': EXPORT_FORMATS[q.format].contentType,
      'content-disposition': `attachment; filename="${exportFilename(q, now)}"`,
      'cache-control': 'no-store',
    });
  });
  app.get('/api/traces/:id', (c) => {
    const t = cue.s.traces.get(c.req.param('id'));
    if (!t) throw new AppError(404, 'not_found', `No trace ${c.req.param('id')}`);
    return c.json(t);
  });
  app.get('/api/insights', (c) => c.json(computeInsights(cue.s.db, cue.s.traces, parseQuery(c, InsightsQuery).range, cue.s.now())));

  app.post('/api/stt/token', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await sttToken({ apiKey: config.stt.deepgramApiKey, ttlSeconds: config.stt.ttlSeconds, host: config.stt.deepgramHost, fetch: cue.s.fetch, now: cue.s.now }));
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
