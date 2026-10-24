import { ApiError, SttTokenResponse, TrellusDispositionsResponse } from '@cue/core';
import { createFakeTrellusFetch, FIXTURE_API_KEY } from '@cue/trellus/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import type { CueServer } from '../src/boot';
import { rulesSummary } from '../src/pipeline/review';
import { json, post, testServer } from './helpers';

let server: CueServer;
afterEach(async () => server && (await server.close()));

describe('POST /api/stt/token', () => {
  it('404 stt_not_configured without DEEPGRAM_API_KEY', async () => {
    server = testServer();
    const res = await post(server, '/api/stt/token');
    expect(res.status).toBe(404);
    expect(ApiError.parse(await json(res)).error.code).toBe('stt_not_configured');
  });

  it('mints a short-lived Deepgram grant and never returns the key', async () => {
    const seen: { url: string; auth: string | null; body: string }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), body: String(init?.body) });
      return new Response(JSON.stringify({ access_token: 'dg_temp_abc', expires_in: 30 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    server = testServer({ fetch: fake, config: { stt: { deepgramApiKey: 'dg_secret_key', ttlSeconds: 30 } }, now: () => 1_000_000 });
    const res = await post(server, '/api/stt/token');
    const text = await res.text();
    expect(text).not.toContain('dg_secret_key');
    const body = SttTokenResponse.parse(JSON.parse(text));
    expect(body).toEqual({ provider: 'deepgram', token: 'dg_temp_abc', expiresAt: 1_030_000 });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(seen[0]!.url).toBe('https://api.deepgram.com/v1/auth/grant');
    expect(seen[0]!.auth).toBe('Token dg_secret_key');
    expect(JSON.parse(seen[0]!.body)).toEqual({ ttl_seconds: 30 });
  });

  it('503 stt_unavailable when Deepgram refuses', async () => {
    server = testServer({ fetch: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch, config: { stt: { deepgramApiKey: 'k', ttlSeconds: 30 } } });
    const res = await post(server, '/api/stt/token');
    expect(res.status).toBe(503);
    expect(ApiError.parse(await json(res)).error.code).toBe('stt_unavailable');
  });
});

describe('/api/trellus/dispositions', () => {
  const put = (s: CueServer, body: unknown) => s.app.request('/api/trellus/dispositions', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('native: lists Cue native labels and takes overrides', async () => {
    server = testServer();
    const d = TrellusDispositionsResponse.parse(await json(server.app.request('/api/trellus/dispositions')));
    expect(d.source).toBe('native');
    expect(d.vocabulary).toContain('Meeting booked');
    expect(d.unmapped).toEqual([]);
  });

  it('trellus: account vocabulary from /bootstrap, overrides persisted and applied', { timeout: 20_000 }, async () => {
    const t0 = Date.now();
    const now = () => Date.parse('2026-10-20T20:00:00Z') + (Date.now() - t0);
    server = testServer({ config: { trellus: { apiKey: FIXTURE_API_KEY, teamId: '', pollSeconds: 0 } }, fetch: createFakeTrellusFetch({ now }) as unknown as typeof fetch, now });
    const d = TrellusDispositionsResponse.parse(await json(server.app.request('/api/trellus/dispositions')));
    expect(d.source).toBe('trellus');
    expect(d.error).toBeNull();
    expect(d.vocabulary.length).toBeGreaterThan(0);
    expect(Object.keys(d.map).length).toBeGreaterThan(0);
    const raw = d.vocabulary[0]!;
    const res = await put(server, { overrides: { [raw]: 'wrong_person' } });
    const after = TrellusDispositionsResponse.parse(await json(res));
    expect(after.overrides).toEqual({ [raw]: 'wrong_person' });
    expect(after.learned.find((l) => l.raw === raw)).toMatchObject({ outcome: 'wrong_person', via: 'override' });
    expect(after.map[raw]).toBe('wrong_person');
    expect(after.unmapped).not.toContain(raw);
    expect((await put(server, { overrides: { x: 'not_an_outcome' } })).status).toBe(400);
  });
});

describe('rules review summary', () => {
  it('writes sentences with the right singular and plural', () => {
    expect(rulesSummary(1, 1, 'meeting_booked')).toMatch(/^Cue showed one card and the rep used it\. The call ended: meeting booked\./);
    expect(rulesSummary(1, 0, 'voicemail')).toContain("one card and the rep didn't use it.");
    expect(rulesSummary(3, 2, 'not_interested', 1)).toContain('Cue showed 3 cards and the rep used 2 of them. One claim broke the sales policy. The call ended: not interested.');
    expect(rulesSummary(2, 2, 'follow_up', 2)).toContain('used all of them. 2 claims broke');
    expect(rulesSummary(0, 0, 'unknown')).toContain("Cue showed no cards on this call. The outcome isn't known yet.");
    expect(rulesSummary(4, 0, 'no_answer')).toContain('used none of them');
  });
});
