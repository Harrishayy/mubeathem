import { describe, expect, it } from 'vitest';
import {
  createTokenBucket,
  createTrellusClient,
  parseRetryAfter,
  TrellusNotFoundError,
  TrellusNotOnDbError,
  TrellusNotPermissionedError,
  TrellusRateLimitError,
  TrellusRequestError,
  TrellusServerError,
  TrellusUnauthorizedError,
  CALLS_ONLY,
  msToMicros,
} from '../src';
import { createFakeTrellusFetch, FIXTURE_API_KEY, FIXTURE_IDS } from '../src/fixtures';
import { fakeClock, OCT_20, OCT_24 } from './helpers';

function setup(fakeOpts: Parameters<typeof createFakeTrellusFetch>[0] = {}, clientOpts: { teamId?: string } = {}) {
  const clock = fakeClock();
  const fetch = createFakeTrellusFetch({ now: clock.now, ...fakeOpts });
  const client = createTrellusClient({ apiKey: FIXTURE_API_KEY, fetch, now: clock.now, sleep: clock.sleep, ...clientOpts });
  return { clock, fetch, client };
}

const listReq = { start: msToMicros(OCT_20), end: msToMicros(OCT_24), select: ['session_id', 'started_at'], cnf: CALLS_ONLY };

describe('auth headers per host', () => {
  it('sends api_key to ext.trellus.ai and never a bearer token', async () => {
    const { client, fetch } = setup();
    await client.visible();
    await client.bootstrap();
    for (const call of fetch.calls) {
      expect(call.url.host).toBe('ext.trellus.ai');
      expect(call.headers.get('api_key')).toBe(FIXTURE_API_KEY);
      expect(call.headers.get('authorization')).toBeNull();
    }
  });

  it('sends Authorization: Bearer to rpt-2.trellus.ai and never api_key', async () => {
    const { client, fetch } = setup();
    await client.sessionList(listReq);
    await client.metricDetails({ start: listReq.start, selects: [{ cnf: [] }] });
    await client.session(FIXTURE_IDS.booked);
    for (const call of fetch.calls) {
      expect(call.url.host).toBe('rpt-2.trellus.ai');
      expect(call.headers.get('authorization')).toBe(`Bearer ${FIXTURE_API_KEY}`);
      expect(call.headers.get('api_key')).toBeNull();
    }
    expect(fetch.calls[0]!.headers.get('content-type')).toBe('application/json');
  });

  it('sends api_key + session_id headers to api.trellus.ai for audio links', async () => {
    const { client, fetch } = setup();
    const res = await client.audioLinks(FIXTURE_IDS.booked);
    expect(res.audio).toHaveLength(1);
    expect(res.audio_links[0]).toMatch(/^https:\/\//);
    const call = fetch.calls[0]!;
    expect(call.url.toString()).toBe('https://api.trellus.ai/get-audio-links');
    expect(call.headers.get('api_key')).toBe(FIXTURE_API_KEY);
    expect(call.headers.get('session_id')).toBe(FIXTURE_IDS.booked);
  });

  it('puts the session id in x-session-id with x-proto-as-json, not the URL', async () => {
    const { client, fetch } = setup();
    const detail = await client.session(FIXTURE_IDS.booked);
    expect(detail.sessionId).toBe(FIXTURE_IDS.booked);
    expect(detail.customerData?.companyName).toBe('Lumenfold AI');
    expect(detail).not.toHaveProperty('wordData');
    const call = fetch.calls[0]!;
    expect(call.url.search).toBe('');
    expect(call.headers.get('x-session-id')).toBe(FIXTURE_IDS.booked);
    expect(call.headers.get('x-proto-as-json')).toBe('true');
  });

  it('sends team_id as a header on /visible and in the body of report requests', async () => {
    const { client, fetch } = setup({}, { teamId: 'tm_corgi_outbound' });
    await client.visible();
    await client.sessionList(listReq);
    expect(fetch.calls[0]!.headers.get('team_id')).toBe('tm_corgi_outbound');
    expect(JSON.parse(fetch.calls[1]!.body!).team_id).toBe('tm_corgi_outbound');
  });

  it('a wrong key is a TrellusUnauthorizedError that never echoes the key', async () => {
    const clock = fakeClock();
    const fetch = createFakeTrellusFetch({ now: clock.now });
    const client = createTrellusClient({ apiKey: 'wrong_key_abcdef', fetch, now: clock.now, sleep: clock.sleep });
    const err = await client.visible().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrellusUnauthorizedError);
    expect((err as TrellusUnauthorizedError).status).toBe(401);
    expect((err as Error).message).not.toContain('wrong_key_abcdef');
  });
});

describe('request validation and units', () => {
  it('sends start/end as Unix microseconds and keeps the body snake_case', async () => {
    const { client, fetch } = setup();
    await client.sessionList({ ...listReq, limit: 10 });
    const body = JSON.parse(fetch.calls[0]!.body!);
    expect(body.start).toBe(OCT_20 * 1000);
    expect(body.end).toBe(OCT_24 * 1000);
    expect(body.select).toEqual(['session_id', 'started_at']);
    expect(body.cnf).toEqual([[{ column_name: 'conversation_type', operator: 'EQ', value_safe: 1 }]]);
  });

  it('rejects milliseconds passed as start, before any request', async () => {
    const { client, fetch } = setup();
    await expect(client.sessionList({ ...listReq, start: OCT_20, end: undefined })).rejects.toBeInstanceOf(TrellusRequestError);
    expect(fetch.calls).toHaveLength(0);
  });

  it('rejects empty OR groups, empty aggregations, out-of-range limits and stray reducers', async () => {
    const { client } = setup();
    await expect(client.sessionList({ ...listReq, cnf: [[]] })).rejects.toThrow(/invalid request/);
    await expect(client.sessionList({ ...listReq, limit: 1001 })).rejects.toThrow(/invalid request/);
    await expect(client.metricDetails({ start: listReq.start, selects: [{}] })).rejects.toThrow(/invalid request/);
    await expect(
      client.sessionList({ ...listReq, cnf: [[{ column_name: 'resource_id', operator: 'EQ', value_safe: 'x', reducer: 'ANY' }]] }),
    ).rejects.toThrow(/invalid request/);
    await expect(
      client.sessionList({ ...listReq, cnf: [[{ column_name: 'resource_id', operator: 'IN', value_safe: 'x' }]] }),
    ).rejects.toThrow(/invalid request/);
  });

  it('returns positional rows newest first; [] is a successful empty result', async () => {
    const { client } = setup();
    const rows = await client.sessionList(listReq);
    expect(rows.length).toBe(7); // six connected calls + one no-answer dial; the messaging session is filtered out
    const started = rows.map((r) => r[1] as number);
    expect([...started].sort((a, b) => b - a)).toEqual(started);
    const none = await client.sessionList({ ...listReq, start: msToMicros(Date.parse('2026-01-01T00:00:00Z')), end: msToMicros(Date.parse('2026-01-02T00:00:00Z')) });
    expect(none).toEqual([]);
  });

  it('metric-details: grouped rows put the group value first, sums count booleans', async () => {
    const { client } = setup();
    const rows = await client.metricDetails({
      start: listReq.start,
      end: listReq.end,
      cnf: CALLS_ONLY,
      selects: [{ cnf: [] }, { column_name: 'duration' }, { column_name: 'sales_metric.has_meeting_confirm' }],
      group_by: { column_name: 'user_log.disposition' },
    });
    const booked = rows.find((r) => r[0] === 'Meeting Booked')!;
    expect(booked[1]).toBe(1);
    expect(booked[2]).toBeCloseTo(238.4);
    expect(booked[3]).toBe(1);
  });
});

describe('documented 401 meanings', () => {
  it('maps "not found", "not permissioned" and "not on db" to their own classes', async () => {
    const { client } = setup({ forbidden: [FIXTURE_IDS.broker], notOnDb: [FIXTURE_IDS.gatekeeper] });
    await expect(client.session('no-such-session')).rejects.toBeInstanceOf(TrellusNotFoundError);
    await expect(client.session(FIXTURE_IDS.broker)).rejects.toBeInstanceOf(TrellusNotPermissionedError);
    const err = await client.session(FIXTURE_IDS.gatekeeper).catch((e: TrellusNotOnDbError) => e);
    expect(err).toBeInstanceOf(TrellusNotOnDbError);
    expect(err.code).toBe('not_on_db');
    expect(err.endpoint).toBe('session');
    expect(err.at).toMatch(/Z$/);
  });

  it('a 400 from audio links for a non-call session is a request error, not retried', async () => {
    const { client, fetch } = setup();
    await expect(client.audioLinks(FIXTURE_IDS.messaging)).rejects.toBeInstanceOf(TrellusRequestError);
    expect(fetch.calls).toHaveLength(1);
  });
});

describe('429 and 5xx handling', () => {
  it('waits Retry-After seconds then retries', async () => {
    const { client, clock, fetch } = setup({ rateLimitEvery: 1, retryAfterSeconds: 3, intercept: undefined });
    // Every request 429s: after max retries the error surfaces with the delay attached.
    const err = await client.visible().catch((e: TrellusRateLimitError) => e);
    expect(err).toBeInstanceOf(TrellusRateLimitError);
    expect(err.retryAfterMs).toBe(3000);
    expect(fetch.calls).toHaveLength(4); // 1 + 3 retries
    const gaps = fetch.calls.slice(1).map((c, i) => c.at - fetch.calls[i]!.at);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(3000);
    expect(clock.sleeps.length).toBeGreaterThan(0);
  });

  it('recovers after a single 429', async () => {
    let n = 0;
    const { client, fetch } = setup({
      intercept: () => (n++ === 0 ? new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }) : undefined),
    });
    const dir = await client.visible();
    expect(dir.users).toHaveLength(3);
    expect(fetch.statuses).toEqual([429, 200]);
    expect(fetch.calls[1]!.at - fetch.calls[0]!.at).toBeGreaterThanOrEqual(2000);
  });

  it('honours a 429 every N calls across a sequence without failing', async () => {
    const { client, fetch } = setup({ rateLimitEvery: 3, retryAfterSeconds: 1 });
    for (let i = 0; i < 4; i++) await client.session(FIXTURE_IDS.booked);
    expect(fetch.statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(fetch.statuses.filter((s) => s === 200)).toHaveLength(4);
  });

  it('gives up immediately when Retry-After is longer than we will wait in-process', async () => {
    const { client, fetch } = setup({ rateLimitEvery: 1, retryAfterSeconds: 600 });
    await expect(client.bootstrap()).rejects.toBeInstanceOf(TrellusRateLimitError);
    expect(fetch.calls).toHaveLength(1);
  });

  it('backs off on 5xx with bounded retries, reading the body as text', async () => {
    const { client, clock, fetch } = setup({ intercept: () => new Response('upstream timeout', { status: 503 }) });
    const err = await client.bootstrap().catch((e: TrellusServerError) => e);
    expect(err).toBeInstanceOf(TrellusServerError);
    expect(err.body).toBe('upstream timeout');
    expect(fetch.calls).toHaveLength(4);
    // Backoff 500 → 1000 → 2000 ms, interleaved with the bootstrap budget's own waits.
    expect(clock.sleeps.filter((s) => [500, 1000, 2000].includes(s))).toEqual([500, 1000, 2000]);
  });

  it('retries network failures, then throws a network error', async () => {
    const clock = fakeClock();
    let n = 0;
    const client = createTrellusClient({
      apiKey: FIXTURE_API_KEY,
      now: clock.now,
      sleep: clock.sleep,
      fetch: async () => {
        n++;
        throw new Error(`ECONNRESET with ${FIXTURE_API_KEY}`);
      },
    });
    const err = await client.visible().catch((e: Error) => e);
    expect(err.name).toBe('TrellusNetworkError');
    expect(err.message).not.toContain(FIXTURE_API_KEY);
    expect(n).toBe(4);
  });

  it('parses Retry-After as seconds or an HTTP date', () => {
    expect(parseRetryAfter('2', 0)).toBe(2000);
    expect(parseRetryAfter(null, 0)).toBe(1000);
    const now = Date.parse('2026-10-23T12:00:00Z');
    expect(parseRetryAfter('Fri, 23 Oct 2026 12:00:05 GMT', now)).toBe(5000);
  });
});

describe('token buckets (fake clock)', () => {
  it('session list: 2 per 4 s and at least 2.5 s apart', async () => {
    const clock = fakeClock(0);
    const bucket = createTokenBucket({ capacity: 2, windowMs: 4000, minGapMs: 2500 }, clock);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      await bucket.take();
      times.push(clock.now());
    }
    expect(times).toEqual([0, 2500, 5000, 7500, 10000]);
  });

  it('metric details: 4 per 4 s burst, then waits for the window', async () => {
    const clock = fakeClock(0);
    const bucket = createTokenBucket({ capacity: 4, windowMs: 4000 }, clock);
    const times: number[] = [];
    for (let i = 0; i < 6; i++) {
      await bucket.take();
      times.push(clock.now());
    }
    expect(times).toEqual([0, 0, 0, 0, 4000, 4000]);
  });

  it('queues concurrent callers in order', async () => {
    const clock = fakeClock(0);
    const bucket = createTokenBucket({ capacity: 1, windowMs: 1000 }, clock);
    const order: number[] = [];
    await Promise.all([0, 1, 2].map((i) => bucket.take().then(() => order.push(i))));
    expect(order).toEqual([0, 1, 2]);
    expect(clock.now()).toBe(2000);
  });

  it('the client never trips the documented per-user limits', async () => {
    const { client, fetch } = setup({ enforceLimits: true });
    await Promise.all([
      ...Array.from({ length: 5 }, () => client.sessionList(listReq)),
      ...Array.from({ length: 6 }, () => client.metricDetails({ start: listReq.start, selects: [{ cnf: [] }] })),
      ...Array.from({ length: 4 }, () => client.session(FIXTURE_IDS.booked)),
      ...Array.from({ length: 3 }, () => client.visible()),
      ...Array.from({ length: 3 }, () => client.bootstrap()),
    ]);
    expect(fetch.statuses.every((s) => s === 200)).toBe(true);
    const lists = fetch.calls.filter((c) => c.endpoint === 'sessionList').map((c) => c.at);
    for (let i = 1; i < lists.length; i++) expect(lists[i]! - lists[i - 1]!).toBeGreaterThanOrEqual(2500);
  });
});
