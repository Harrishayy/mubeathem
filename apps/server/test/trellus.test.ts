import { CallEvent } from '@cue/core';
import { createFakeTrellusFetch, FIXTURE_API_KEY, FIXTURE_CALLS } from '@cue/trellus/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import type { CueServer } from '../src/boot';
import { post, json, testServer } from './helpers';

let server: CueServer;
afterEach(async () => server && (await server.close()));

const START = Date.parse('2026-10-20T16:02:20Z');

/** A clock at `t` that still moves in real time (the client's token buckets refill on it). */
function moving(t: number) {
  const t0 = Date.now();
  const clock = { base: t, get t() { return this.base + (Date.now() - t0); }, set t(v: number) { this.base = v - (Date.now() - t0); } };
  return clock;
}

function trellusServer(clock: { t: number }) {
  const fake = createFakeTrellusFetch({ now: () => clock.t });
  server = testServer({
    env: { TRELLUS_API_KEY: FIXTURE_API_KEY, TRELLUS_POLL_SECONDS: '5' },
    config: { trellus: { apiKey: FIXTURE_API_KEY, teamId: '', pollSeconds: 5 } },
    fetch: fake as unknown as typeof fetch,
    now: () => clock.t,
  });
  return fake;
}

describe('Trellus integration (fixtures via the fake fetch)', () => {
  it('the outcome poller matches an ended call to its Trellus disposition', async () => {
    const clock = moving(START);
    const fake = trellusServer(clock);
    expect(server.cue.trellus.kind).toBe('trellus');
    const view = await json(post(server, '/api/calls', { source: 'trellus', prospect: { name: 'Priya Raman', title: 'CEO', company: 'Lumenfold AI', phone: '415-555-0142', facts: {} }, rep: { id: 'usr_7f3a1c', name: 'Dana' } }));
    clock.t += 240_000;
    await post(server, `/api/calls/${view.id}/end`, {});
    server.startBackground();
    await server.cue.trellus.pollOnce();
    await server.cue.idle();
    const v = server.cue.getCall(view.id);
    expect(v.outcome?.source).toBe('trellus');
    expect(v.outcome?.outcome).toBe('meeting_booked');
    expect(Object.keys(v.outcome?.raw ?? {}).length).toBeGreaterThan(0);
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const c of fake.calls) expect(c.url.toString()).not.toContain(FIXTURE_API_KEY);
  });

  it('sync imports recent sessions once (dedupe by session id) with transcripts and outcomes', { timeout: 20_000 }, async () => {
    const clock = moving(START + 3 * 3600_000);
    trellusServer(clock);
    const res = await json(post(server, '/api/trellus/sync'));
    expect(res.source).toBe('trellus');
    expect(res.imported).toBeGreaterThan(0);
    expect(res.imported).toBeLessThanOrEqual(FIXTURE_CALLS.length);
    expect(res).not.toHaveProperty('importedIds');
    const again = await json(post(server, '/api/trellus/sync'));
    expect(again.imported).toBe(0);
    expect(again.skipped).toBe(res.imported);

    const calls = server.cue.s.store.calls({ limit: 50 });
    const withTurns = calls.filter((c) => server.cue.getCall(c.id).turns.length > 0);
    expect(withTurns.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.source).toBe('import');
      for (const e of server.cue.s.store.list(c.id)) CallEvent.parse(e);
    }
    expect(server.cue.trellus.status().lastSyncAt).toBeGreaterThan(START);
  });
});
