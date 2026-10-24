import { describe, expect, it } from 'vitest';
import { OUTCOMES } from '@cue/core';
import { dialLink, listSessionsSplitting, loadTrellusConfig, NATIVE_DISPOSITIONS, NativeSource, type ImportedCall } from '../src';
import { runCheck } from '../src/cli';
import { createFakeTrellusFetch, FIXTURE_API_KEY } from '../src/fixtures';

describe('config', () => {
  it('reads the env; no key → not configured', () => {
    expect(loadTrellusConfig({})).toEqual({ apiKey: null, teamId: null, pollSeconds: 60, configured: false });
    expect(loadTrellusConfig({ TRELLUS_API_KEY: ' k ', TRELLUS_TEAM_ID: 'tm', TRELLUS_POLL_SECONDS: '30' })).toEqual({ apiKey: 'k', teamId: 'tm', pollSeconds: 30, configured: true });
    expect(loadTrellusConfig({ TRELLUS_POLL_SECONDS: '0' }).pollSeconds).toBe(0);
    expect(loadTrellusConfig({ TRELLUS_POLL_SECONDS: '1' }).pollSeconds).toBe(5);
    expect(loadTrellusConfig({ TRELLUS_POLL_SECONDS: 'soon' }).pollSeconds).toBe(60);
  });
});

describe('NativeSource', () => {
  const call = (id: string, startedAt: number): ImportedCall => ({
    trellusSessionId: id,
    startedAt,
    durationMs: 1000,
    prospect: { name: '', title: '', company: '', facts: {} },
    rep: { id: 'r', name: 'R' },
    turns: [],
    outcome: null,
    raw: {},
  });

  it('never finds an outcome (the rep tap is the record) and lists from the store, newest first', async () => {
    const src = new NativeSource({ store: () => [call('a', 10), call('b', 30), call('c', 5)] });
    expect(src.kind).toBe('native');
    expect(await src.findOutcome({ startedAt: 0, prospect: { name: '', title: '', company: '', facts: {} } })).toBeNull();
    expect((await src.listRecent({ since: 8, limit: 5 })).map((c) => c.trellusSessionId)).toEqual(['b', 'a']);
  });

  it('offers every outcome except unknown, booked first', () => {
    expect(NATIVE_DISPOSITIONS[0]).toEqual({ outcome: 'meeting_booked', label: 'Meeting booked', key: 'b' });
    expect(NATIVE_DISPOSITIONS.map((d) => d.outcome).sort()).toEqual(OUTCOMES.filter((o) => o !== 'unknown').sort());
    expect(new Set(NATIVE_DISPOSITIONS.map((d) => d.key)).size).toBe(NATIVE_DISPOSITIONS.length);
  });

  it('dialLink builds tel: links', () => {
    expect(dialLink('(415) 555-0142')).toBe('tel:+14155550142');
    expect(dialLink('+44 20 7946 0958')).toBe('tel:+442079460958');
    expect(dialLink('415-555-0142 ext. 7')).toBe('tel:+14155550142;ext=7');
    expect(() => dialLink('call me')).toThrow(RangeError);
  });
});

describe('listSessionsSplitting', () => {
  it('splits windows that hit the cap and de-duplicates by session_id', async () => {
    const day = 86_400_000_000;
    const start = 1_792_000_000_000_000;
    // 6 sessions, one per day; a cap of 2 forces splits.
    const sessions = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, us: start + i * day + 1 }));
    const calls: Array<[number, number]> = [];
    const client = {
      sessionList: async (req: { start: number; end?: number; limit?: number }) => {
        calls.push([req.start, req.end!]);
        return sessions
          .filter((s) => s.us >= req.start && s.us < req.end!)
          .sort((a, b) => b.us - a.us)
          .slice(0, req.limit)
          .map((s) => [s.id, Math.floor(s.us / 1e6)]);
      },
    };
    const res = await listSessionsSplitting(client, { start, end: start + 6 * day, select: ['session_id', 'started_at'], limit: 2 });
    expect(res.rows.map((r) => r[0])).toEqual(['s5', 's4', 's3', 's2', 's1', 's0']);
    expect(res.capped).toBe(false);
    expect(res.requests).toBe(calls.length);
    expect(res.requests).toBeGreaterThan(1);
  });

  it('reports capped when the smallest window is still full', async () => {
    const client = { sessionList: async () => [['a'], ['b']] };
    const res = await listSessionsSplitting(client, { start: 1e15, end: 1e15 + 1000, select: ['session_id'], limit: 2 });
    expect(res.capped).toBe(true);
  });
});

describe('cli check', () => {
  it('explains when no key is set', async () => {
    const lines: string[] = [];
    expect(await runCheck({}, { print: (l) => lines.push(l) })).toBe(0);
    expect(lines.join('\n')).toMatch(/no key set/);
  });

  it('prints a redacted summary and never the key', async () => {
    const lines: string[] = [];
    const code = await runCheck({ TRELLUS_API_KEY: FIXTURE_API_KEY }, { fetch: createFakeTrellusFetch(), print: (l) => lines.push(l) });
    const text = lines.join('\n');
    expect(code).toBe(0);
    expect(text).not.toContain(FIXTURE_API_KEY);
    expect(text).toContain('j***@corgi.example');
    expect(text).not.toContain('jordan@corgi.example');
    expect(text).toMatch(/Bad Timing - Q1\s+→ unknown \(unmapped\)/);
  });

  it('fails clearly on a bad key', async () => {
    const lines: string[] = [];
    const code = await runCheck({ TRELLUS_API_KEY: 'nope_nope' }, { fetch: createFakeTrellusFetch(), print: (l) => lines.push(l) });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/TrellusUnauthorizedError \(401\)/);
  });
});
