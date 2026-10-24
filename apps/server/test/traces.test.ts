import {
  ApiError,
  demoEvents,
  DEMO_STARTED_AT,
  InsightsResponse,
  MubitTrace,
  computeFeatures,
  TASK_IDS,
  TraceListResponse,
  type CallEvent,
  type CallEventInput,
  type ReadMomentInput,
  type Suggestion,
} from '@cue/core';
import { afterEach, describe, expect, it } from 'vitest';
import { TASKS } from '../src/adapters/mubit';
import type { CueServer } from '../src/boot';
import { exportTraces, openaiRow } from '../src/services/trace-export';
import { openDb, type Db } from '../src/store/db';
import { computeInsights } from '../src/store/insights';
import { TraceStore, type TraceInput } from '../src/store/traces';
import { createCall, fakeMubit, json, post, testServer } from './helpers';

let server: CueServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = (db: Db) => (db.prepare('SELECT COUNT(*) AS n FROM mubit_traces').get() as { n: number }).n;

function trace(over: Partial<TraceInput> = {}): TraceInput {
  return {
    requestId: 'mreq_1',
    task: 'read_moment',
    model: 'gpt-4o-mini',
    sessionId: 'call_t1',
    ok: true,
    errorCode: null,
    errorMessage: null,
    latencyMs: 100,
    attempts: 1,
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.0001,
    at: 1_000_000,
    instructionsVersion: TASKS.read_moment.version,
    input: { hello: 'world' },
    output: { moment: 'opener' },
    aborted: false,
    ...over,
  };
}

const READ_INPUT: ReadMomentInput = {
  crm: { title: 'CEO', company: 'Lumen', facts: {} },
  window: [{ speaker: 'prospect', text: "what's this regarding?", tMs: 1000 }],
  features: computeFeatures([{ id: 'turn_1', speaker: 'prospect', text: "what's this regarding?", tMs: 1000, durMs: 900, final: true, via: 'typed' }], 0),
  previous: null,
};

describe('TraceStore buffering', () => {
  it('queues in memory and writes in one flush after flushMs, never on record()', async () => {
    const db = openDb(':memory:');
    const store = new TraceStore(db, { record: 'full', maxBodyBytes: 65536, flushMs: 30, flushRows: 50 });
    store.record(trace());
    store.record(trace({ requestId: 'mreq_2' }));
    expect(count(db)).toBe(0);
    expect(store.pending).toBe(2);
    await sleep(80);
    expect(count(db)).toBe(2);
    expect(store.pending).toBe(0);
    db.close();
  });

  it('flushes as soon as flushRows are waiting (next tick, not inline)', async () => {
    const db = openDb(':memory:');
    const store = new TraceStore(db, { record: 'full', maxBodyBytes: 65536, flushMs: 60_000, flushRows: 5 });
    for (let i = 0; i < 5; i++) store.record(trace({ requestId: `mreq_${i}` }));
    expect(count(db)).toBe(0);
    await new Promise((r) => setImmediate(r));
    expect(count(db)).toBe(5);
    db.close();
  });

  it('flushes on close, and drops (does not throw) after close', () => {
    const db = openDb(':memory:');
    const store = new TraceStore(db, { record: 'full', maxBodyBytes: 65536, flushMs: 60_000 });
    store.record(trace());
    store.close();
    expect(count(db)).toBe(1);
    expect(store.record(trace())).toBeNull();
    db.close();
  });

  it('server close flushes traces queued by the pipeline', async () => {
    server = testServer({ config: { traces: { retentionDays: 0, maxBodyBytes: 65536, flushMs: 60_000, flushRows: 10_000 } } });
    const db = server.cue.s.db;
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "...what's this regarding?" });
    await server.cue.idle();
    expect(count(db)).toBe(0);
    expect(server.cue.s.traces.pending).toBeGreaterThan(0);
    // close() closes the db too, so read through a flush hook first
    server.flushTraces();
    expect(count(db)).toBeGreaterThan(0);
  });

  it('links call and suggestion ids by request id, even while the trace is still buffered', () => {
    const db = openDb(':memory:');
    const store = new TraceStore(db, { record: 'full', maxBodyBytes: 65536, flushMs: 60_000 });
    store.record(trace({ requestId: 'mreq_w', task: 'write_line', sessionId: 'seed_x' }));
    store.link('mreq_w', 'call_x', 'sug_x');
    store.link('mreq_w', 'call_x', null); // a later link without a suggestion keeps the first one
    const [t] = store.list({ limit: 10 }).items;
    expect(t).toMatchObject({ callId: 'call_x', suggestionId: 'sug_x' });
    db.close();
  });

  it('prunes by retention days on boot', () => {
    const db = openDb(':memory:');
    const store = new TraceStore(db, { record: 'full', maxBodyBytes: 65536 });
    const now = 100 * 86_400_000;
    store.record(trace({ at: now - 10 * 86_400_000 }));
    store.record(trace({ at: now - 1 * 86_400_000 }));
    store.flush();
    expect(store.prune(0, now)).toBe(0);
    expect(store.prune(7, now)).toBe(1);
    expect(count(db)).toBe(1);
    db.close();
  });
});

describe('TraceStore bodies', () => {
  it('caps a runaway body and marks the row truncated', () => {
    const db = openDb(':memory:');
    const store = new TraceStore(db, { record: 'full', maxBodyBytes: 256 });
    const id = store.record(trace({ output: { say: 'x'.repeat(10_000) } }))!;
    const t = store.get(id)!;
    expect(t.truncated).toBe(true);
    expect(typeof t.output).toBe('string');
    expect(Buffer.byteLength(t.output as string)).toBeLessThanOrEqual(256);
    expect(t.input).toEqual({ hello: 'world' });
    db.close();
  });

  it('metadata mode keeps no bodies', () => {
    const db = openDb(':memory:');
    const store = new TraceStore(db, { record: 'metadata', maxBodyBytes: 65536 });
    const id = store.record(trace())!;
    const t = store.get(id)!;
    expect(t.input).toBeNull();
    expect(t.output).toBeNull();
    expect(t.requestId).toBe('mreq_1');
    db.close();
  });

  it('CUE_MUBIT_RECORD=metadata applies to traces from the live pipeline', async () => {
    server = testServer({ env: { CUE_MUBIT_RECORD: 'metadata' } });
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "...what's this regarding?" });
    await server.cue.idle();
    const list = TraceListResponse.parse(await json(server.app.request(`/api/traces?callId=${id}`)));
    expect(list.items.length).toBeGreaterThan(0);
    const detail = MubitTrace.parse(await json(server.app.request(`/api/traces/${list.items[0]!.id}`)));
    expect(detail.input).toBeNull();
    expect(detail.output).toBeNull();
  });
});

describe('capture in ModelRunner', () => {
  it('records every successful call with request id, version, bodies, and links the card', async () => {
    server = testServer();
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "...what's this regarding?" });
    await server.cue.idle();
    const card = server.cue.getCall(id).current!;
    const items = server.cue.s.traces.list({ callId: id, limit: 100 }).items;
    const tasks = items.map((t) => t.task);
    expect(tasks).toContain('research_brief');
    expect(tasks).toContain('read_moment');
    expect(tasks).toContain('write_line');
    for (const t of items) {
      expect(t.requestId).toMatch(/^mreq_fake_/);
      expect(t.callId).toBe(id);
      expect(t.sessionId).toBe(id);
      expect(t.instructionsVersion).toBe(TASKS[t.task].version);
      expect(t.inputTokens).toBe(100);
    }
    const write = items.find((t) => t.task === 'write_line' && t.ok && !t.aborted && t.suggestionId);
    expect(write?.suggestionId).toBe(card.id);
    expect(card.mubitRequestIds).toContain(write!.requestId);
    const full = server.cue.s.traces.get(write!.id)!;
    expect((full.input as { candidates: unknown[] }).candidates.length).toBeGreaterThan(0);
    expect((full.output as { say: string }).say.length).toBeGreaterThan(0);
  });

  it('records failures and timeouts with their code and message', async () => {
    server = testServer({
      mubit: fakeMubit({ fail: { read_moment: 'hang', write_line: 'http' } }),
      config: { budgets: { readMs: 40, writeMs: 500, checkMs: 60, briefMs: 500, reviewMs: 200, simMs: 60, liveMs: 500 } },
    });
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: 'We already have a broker.' });
    await server.cue.idle();
    const items = server.cue.s.traces.list({ callId: id, ok: false, limit: 100 }).items;
    const read = items.find((t) => t.task === 'read_moment');
    expect(read).toMatchObject({ ok: false, errorCode: 'timeout', aborted: false });
    expect(read!.errorMessage).toContain('budget');
    const write = items.find((t) => t.task === 'write_line');
    expect(write).toMatchObject({ ok: false, errorCode: 'http', errorMessage: 'upstream 500' });
  });

  it('records a sent-then-cancelled run as aborted; a cancelled-before-sent run leaves no trace', async () => {
    server = testServer({ mubit: fakeMubit({ delayMs: { read_moment: 200 } }) });
    const ac = new AbortController();
    const p = server.cue.s.models.run('read_moment', READ_INPUT, { callId: 'call_abort', signal: ac.signal, budgetMs: 5000 });
    setTimeout(() => ac.abort(), 20);
    const r = await p;
    expect(r.ok).toBe(false);
    const pre = new AbortController();
    pre.abort();
    await server.cue.s.models.run('read_moment', READ_INPUT, { callId: 'call_abort', signal: pre.signal, budgetMs: 5000 });
    const items = server.cue.s.traces.list({ callId: 'call_abort', limit: 10 }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ aborted: true, errorCode: 'aborted', ok: false });
  });
});

describe('GET /api/traces', () => {
  function seedTraces(s: CueServer, n: number) {
    for (let i = 0; i < n; i++)
      s.cue.s.traces.record(trace({ requestId: `mreq_${i}`, task: i % 2 ? 'write_line' : 'read_moment', ok: i % 5 !== 0, sessionId: i < 6 ? 'call_a' : 'call_b', at: 1_000_000 + i }));
  }

  it('paginates newest first with a cursor and filters by task, call and ok', async () => {
    server = testServer({ mubit: null });
    seedTraces(server, 12);
    const p1 = TraceListResponse.parse(await json(server.app.request('/api/traces?limit=5')));
    expect(p1.items.map((t) => t.requestId)).toEqual(['mreq_11', 'mreq_10', 'mreq_9', 'mreq_8', 'mreq_7']);
    expect(p1.items[0]).not.toHaveProperty('input');
    const p2 = TraceListResponse.parse(await json(server.app.request(`/api/traces?limit=5&before=${p1.nextCursor}`)));
    expect(p2.items.map((t) => t.requestId)).toEqual(['mreq_6', 'mreq_5', 'mreq_4', 'mreq_3', 'mreq_2']);
    const p3 = TraceListResponse.parse(await json(server.app.request(`/api/traces?limit=5&before=${p2.nextCursor}`)));
    expect(p3.items).toHaveLength(2);
    expect(p3.nextCursor).toBeNull();

    const writes = TraceListResponse.parse(await json(server.app.request('/api/traces?task=write_line&limit=500')));
    expect(writes.items.every((t) => t.task === 'write_line')).toBe(true);
    expect(writes.items).toHaveLength(6);
    const failed = TraceListResponse.parse(await json(server.app.request('/api/traces?ok=false')));
    expect(failed.items.map((t) => t.requestId)).toEqual(['mreq_10', 'mreq_5', 'mreq_0']);
    const callA = TraceListResponse.parse(await json(server.app.request('/api/traces?callId=call_a&ok=true')));
    expect(callA.items.map((t) => t.requestId)).toEqual(['mreq_4', 'mreq_3', 'mreq_2', 'mreq_1']);
  });

  it('rejects bad query params with ApiError; unknown trace is 404', async () => {
    server = testServer({ mubit: null });
    for (const q of ['limit=0', 'limit=501', 'task=nope', 'ok=maybe', 'before=abc']) {
      const res = await server.app.request(`/api/traces?${q}`);
      expect(res.status, q).toBe(400);
      expect(ApiError.parse(await res.json()).error.code).toBe('invalid_request');
    }
    expect((await server.app.request('/api/insights?range=1y')).status).toBe(400);
    expect((await server.app.request('/api/traces/export?format=csv')).status).toBe(400);
    const missing = await server.app.request('/api/traces/trc_nope');
    expect(missing.status).toBe(404);
    expect(ApiError.parse(await missing.json()).error.code).toBe('not_found');
  });

  it('honours the API token like every other /api route', async () => {
    server = testServer({ mubit: null, config: { apiToken: 'sekrit' } });
    expect((await server.app.request('/api/traces')).status).toBe(401);
    expect((await server.app.request('/api/insights', { headers: { 'x-cue-token': 'sekrit' } })).status).toBe(200);
  });
});

/* ───────── insights on a fixture DB ───────── */

const HOUR = 3_600_000;

/** A second, unbooked call: one line card (cloned from the demo), never used, outcome not_interested. */
function coldCall(demo: CallEvent[], callId: string, startedAt: number): CallEventInput[] {
  const started = demo.find((e) => e.type === 'call.started')!;
  const card = demo.find((e): e is Extract<CallEvent, { type: 'suggestion.shown' }> => e.type === 'suggestion.shown' && e.suggestion.kind === 'line')!.suggestion;
  const suggestion: Suggestion = { ...card, id: 'sug_cold_1', callId, createdAt: startedAt + 5000, latencyMs: 1500, servedBy: 'mubit', writePath: 'speculative' };
  return [
    { ...(started as Extract<CallEvent, { type: 'call.started' }>), callId, at: startedAt },
    { type: 'suggestion.shown', callId, at: startedAt + 5000, suggestion },
    { type: 'suggestion.action', callId, at: startedAt + 6000, suggestionId: 'sug_cold_1', action: 'dismissed' },
    { type: 'call.ended', callId, at: startedAt + 60_000, durationMs: 60_000 },
    { type: 'outcome.recorded', callId, at: startedAt + 61_000, outcome: { outcome: 'not_interested', source: 'rep', raw: {}, at: startedAt + 61_000 } },
  ];
}

describe('insights', () => {
  it('per-task numbers, series and outcome math on a seeded fixture', () => {
    server = testServer({ mubit: null });
    const { db, store, traces } = server.cue.s;
    const demo = demoEvents();
    for (const e of demo) store.append(e as CallEventInput);
    const coldAt = DEMO_STARTED_AT + 2 * HOUR;
    for (const e of coldCall(demo, 'call_cold', coldAt)) store.append(e);

    const base = DEMO_STARTED_AT;
    const rm = (lat: number, at: number, o: Partial<TraceInput> = {}) => traces.record(trace({ task: 'read_moment', latencyMs: lat, at, costUsd: 0.001, ...o }));
    rm(100, base + 10);
    rm(200, base + 20);
    rm(300, base + HOUR + 5);
    rm(400, base + HOUR + 6);
    rm(50, base + HOUR + 7, { ok: false, errorCode: 'http', costUsd: 0, inputTokens: 0, outputTokens: 0 });
    rm(70, base + HOUR + 8, { ok: false, errorCode: 'aborted', aborted: true, costUsd: 0, inputTokens: 0, outputTokens: 0 });
    traces.record(trace({ task: 'write_line', latencyMs: 900, at: base + 30, costUsd: 0.002 }));
    traces.record(trace({ task: 'write_line', latencyMs: 500, at: base - 3 * 86_400_000, costUsd: 0.002 })); // outside 24h

    const now = base + 3 * HOUR;
    const ins = InsightsResponse.parse(computeInsights(db, traces, '24h', now));
    expect(ins.bucket).toBe('hour');
    expect(ins.since).toBe(now - 24 * HOUR);
    const read = ins.tasks.find((t) => t.task === 'read_moment')!;
    expect(read).toMatchObject({ calls: 6, ok: 4, failed: 1, aborted: 1, p50Ms: 200, p95Ms: 400, errorsByCode: { http: 1 }, inputTokens: 400, outputTokens: 80 });
    expect(read.costUsd).toBeCloseTo(0.004, 6);
    expect(ins.tasks.find((t) => t.task === 'write_line')!.calls).toBe(1);
    expect(ins.totals.calls).toBe(7);
    const readSeries = ins.series.filter((p) => p.task === 'read_moment');
    expect(readSeries).toEqual([
      { t: Math.floor(base / HOUR) * HOUR, task: 'read_moment', calls: 2, costUsd: 0.002, p50Ms: 100 },
      { t: Math.floor(base / HOUR) * HOUR + HOUR, task: 'read_moment', calls: 4, costUsd: 0.002, p50Ms: 300 },
    ]);
    expect(InsightsResponse.parse(computeInsights(db, traces, '7d', now)).bucket).toBe('day');
    expect(computeInsights(db, traces, 'all', now).tasks.find((t) => t.task === 'write_line')!.calls).toBe(2);

    /* outcomes, recomputed independently from the fixture */
    const o = ins.outcomes;
    const demoCards = demo.flatMap((e) => (e.type === 'suggestion.shown' ? [e.suggestion] : []));
    const demoUsed = new Set(demo.flatMap((e) => (e.type === 'suggestion.action' && (e.action === 'used' || e.action === 'edited') ? [e.suggestionId] : [])));
    const review = demo.find((e): e is Extract<CallEvent, { type: 'review.completed' }> => e.type === 'review.completed')!.review;
    for (const l of review.linesUsed) if (l.used) demoUsed.add(l.suggestionId);
    expect(demoUsed.size).toBeGreaterThan(0);

    expect(o.calls).toEqual({ total: 2, withOutcome: 2, booked: 1, bookingRate: 0.5 });
    expect(o.cueUsage).toEqual({ used: { calls: 1, booked: 1, bookingRate: 1 }, notUsed: { calls: 1, booked: 0, bookingRate: 0 } });
    expect(o.servedBy.cards).toEqual({ mubit: 1, rules: demoCards.length, cache: 0 });
    expect(o.servedBy.reads.rules).toBe(demo.filter((e) => e.type === 'situation.read').length);
    expect(o.writePath).toEqual({ speculative: 1, rewritten: 0, direct: 0 });
    const lineLatencies = [...demoCards.filter((c) => c.kind === 'line').map((c) => c.latencyMs), 1500].sort((a, b) => a - b);
    expect(o.latency.cards).toBe(lineLatencies.length);
    expect(o.latency.p95Ms).toBe(lineLatencies[Math.ceil(0.95 * lineLatencies.length) - 1]);
    expect(o.reviews).toEqual({ count: 1, mubit: 0, avgSuggestionImpact: 0.7, avgRating: 5 });

    const totalShown = o.moments.reduce((a, m) => a + m.shown, 0);
    expect(totalShown).toBe(demoCards.length + 1);
    expect(o.moments.reduce((a, m) => a + m.used, 0)).toBe(demoUsed.size);
    expect(o.moments.reduce((a, m) => a + m.booked, 0)).toBe(demoCards.length);
    expect(o.moments.reduce((a, m) => a + m.judged, 0)).toBe(review.linesUsed.length);
    expect(o.moments.reduce((a, m) => a + m.stepWins, 0)).toBe(review.linesUsed.filter((l) => l.stepWin).length);
    const coldMoment = o.moments.find((m) => m.moment === demoCards.find((c) => c.kind === 'line')!.situation.moment)!;
    expect(coldMoment.bookedRate).toBeCloseTo(coldMoment.booked / coldMoment.shown, 3);

    expect(o.topLines[0]!.booked).toBeGreaterThanOrEqual(o.topLines[o.topLines.length - 1]!.booked);
    expect(o.topLines.every((l) => l.text.length > 0)).toBe(true);
  });

  it('GET /api/insights answers on an empty store', async () => {
    server = testServer({ mubit: null });
    const ins = InsightsResponse.parse(await json(server.app.request('/api/insights?range=30d')));
    expect(ins.range).toBe('30d');
    expect(ins.tasks).toHaveLength(TASK_IDS.length);
    expect(ins.outcomes.calls.bookingRate).toBe(0);
    expect(ins.outcomes.reviews.avgSuggestionImpact).toBeNull();
  });
});

/* ───────── exports ───────── */

describe('exports', () => {
  function seeded(s: CueServer) {
    const t = s.cue.s.traces;
    const now = s.cue.s.now();
    t.record(trace({ requestId: 'mreq_a', sessionId: 'call_e1', at: now - 1000, input: { a: 1 }, output: { b: 2 } }));
    t.record(trace({ requestId: 'mreq_b', sessionId: 'call_e1', at: now - 900, ok: false, errorCode: 'http', errorMessage: 'upstream 500', output: null }));
    t.record(trace({ requestId: 'mreq_c', sessionId: 'call_e2', task: 'write_line', instructionsVersion: TASKS.write_line.version, at: now - 800 }));
    t.record(trace({ requestId: 'mreq_old', sessionId: 'call_e2', at: now - 40 * 86_400_000 }));
    t.record(trace({ requestId: 'mreq_stale', sessionId: 'call_e2', at: now - 700, instructionsVersion: -1 }));
  }

  it('jsonl: every trace in range, oldest first, with bodies', async () => {
    server = testServer({ mubit: null });
    seeded(server);
    const res = await server.app.request('/api/traces/export?format=jsonl&range=30d');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('ndjson');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="cue-traces-all-30d-.*\.jsonl"/);
    const rows = (await res.text()).trim().split('\n').map((l) => MubitTrace.parse(JSON.parse(l)));
    expect(rows.map((r) => r.requestId)).toEqual(['mreq_a', 'mreq_b', 'mreq_c', 'mreq_stale']);
    expect(rows[0]!.input).toEqual({ a: 1 });
    const filtered = (await (await server.app.request('/api/traces/export?task=write_line')).text()).trim().split('\n');
    expect(filtered).toHaveLength(1);
  });

  it('openai: chat fine-tune rows for ok traces with the current instructions only', async () => {
    server = testServer({ mubit: null });
    seeded(server);
    const text = await (await server.app.request('/api/traces/export?format=openai&range=all')).text();
    const rows = text.trim().split('\n').map((l) => JSON.parse(l) as { messages: { role: string; content: string }[] });
    expect(rows).toHaveLength(3); // a, c, old (b failed, stale has an old version)
    const first = rows[0]!;
    expect(first.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(first.messages[0]!.content).toBe(TASKS.read_moment.instructions);
    expect(JSON.parse(first.messages[1]!.content)).toEqual({ a: 1 });
    expect(JSON.parse(first.messages[2]!.content)).toEqual({ b: 2 });
    expect(rows[1]!.messages[0]!.content).toBe(TASKS.write_line.instructions);
    expect(openaiRow({ ...MubitTrace.parse({ ...trace(), id: 'trc_x', callId: null, suggestionId: null }), truncated: true })).toBeNull();
  });

  it('langfuse: one ingestion batch, trace-create per session then generation-create per call', async () => {
    server = testServer({ mubit: null });
    seeded(server);
    const res = await server.app.request('/api/traces/export?format=langfuse&range=7d');
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { batch: { id: string; type: string; timestamp: string; body: Record<string, any> }[] };
    expect(body.batch.map((e) => e.type)).toEqual(['trace-create', 'generation-create', 'generation-create', 'trace-create', 'generation-create', 'generation-create']);
    const [t1, g1, g2] = body.batch;
    expect(t1!.body).toMatchObject({ id: 'cue-call_e1', sessionId: 'call_e1', name: 'cue.call' });
    expect(g1!.body).toMatchObject({ traceId: 'cue-call_e1', name: 'read_moment', model: 'gpt-4o-mini', usage: { input: 100, output: 20, total: 120, unit: 'TOKENS' }, input: { a: 1 }, output: { b: 2 }, level: 'DEFAULT' });
    expect(g1!.body.metadata.requestId).toBe('mreq_a');
    expect(Date.parse(g1!.body.endTime) - Date.parse(g1!.body.startTime)).toBe(100);
    expect(g2!.body).toMatchObject({ level: 'ERROR', statusMessage: 'http: upstream 500', output: null });
    expect(new Set(body.batch.map((e) => e.id)).size).toBe(body.batch.length);
  });

  it('the generator reads big stores page by page', () => {
    const db = openDb(':memory:');
    const store = new TraceStore(db, { record: 'full', maxBodyBytes: 65536 });
    for (let i = 0; i < 1203; i++) store.record(trace({ requestId: `r${i}`, at: 1000 + i }));
    const lines = [...exportTraces(store, { format: 'jsonl', range: 'all' }, 10_000)];
    expect(lines).toHaveLength(1203);
    expect(JSON.parse(lines[1202]!).requestId).toBe('r1202');
    db.close();
  });
});
