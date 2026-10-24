import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutcomeRecord } from '@cue/core';
import { createOutcomePoller, GIVE_UP_AFTER_MS, type CallSource, type OpenCall } from '../src';

const prospect = { name: 'Priya Raman', title: '', company: 'Lumenfold AI', facts: {} };
const rec: OutcomeRecord = { outcome: 'meeting_booked', source: 'trellus', raw: {}, at: 0 };

function fakeSource(answers: Record<string, Array<OutcomeRecord | null | Error>>): CallSource & { asked: number[] } {
  const asked: number[] = [];
  return {
    kind: 'trellus',
    asked,
    async findOutcome(q) {
      asked.push(q.startedAt);
      const next = answers[String(q.startedAt)]?.shift() ?? null;
      if (next instanceof Error) throw next;
      return next;
    },
    async listRecent() {
      return [];
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('outcome poller', () => {
  it('reports an outcome once and stops asking for that call', async () => {
    const source = fakeSource({ '1000': [null, rec] });
    const got: string[] = [];
    const open: OpenCall[] = [{ callId: 'call_a', startedAt: 1000, endedAt: 2000, prospect }];
    const poller = createOutcomePoller({ source, intervalMs: 1000, getOpenCalls: () => open, onOutcome: (id) => void got.push(id), now: () => 3000 });
    await poller.tick();
    expect(got).toEqual([]);
    await poller.tick();
    expect(got).toEqual(['call_a']);
    await poller.tick();
    expect(source.asked).toHaveLength(2);
  });

  it('gives up on a call 2 h after it ended', async () => {
    const source = fakeSource({});
    const gaveUp: string[] = [];
    let now = 0;
    const open: OpenCall[] = [{ callId: 'call_b', startedAt: 0, endedAt: 60_000, prospect }];
    const poller = createOutcomePoller({ source, intervalMs: 1000, getOpenCalls: () => open, onOutcome: () => {}, onGiveUp: (id) => void gaveUp.push(id), now: () => now });
    now = 60_000 + GIVE_UP_AFTER_MS;
    await poller.tick();
    expect(source.asked).toHaveLength(1);
    now += 1;
    await poller.tick();
    await poller.tick();
    expect(gaveUp).toEqual(['call_b']);
    expect(source.asked).toHaveLength(1);
  });

  it('never throws: errors go to onError and the next call is still polled', async () => {
    const source = fakeSource({ '1': [new Error('429')], '2': [rec] });
    const errors: Array<string | undefined> = [];
    const got: string[] = [];
    const poller = createOutcomePoller({
      source,
      intervalMs: 1000,
      getOpenCalls: () => [
        { callId: 'call_1', startedAt: 1, prospect },
        { callId: 'call_2', startedAt: 2, prospect },
      ],
      onOutcome: (id) => void got.push(id),
      onError: (_e, id) => void errors.push(id),
      now: () => 10,
    });
    await expect(poller.tick()).resolves.toBeUndefined();
    expect(errors).toEqual(['call_1']);
    expect(got).toEqual(['call_2']);
    const broken = createOutcomePoller({ source, intervalMs: 1, getOpenCalls: () => Promise.reject(new Error('db')), onOutcome: () => {}, onError: () => { throw new Error('bad handler'); } });
    await expect(broken.tick()).resolves.toBeUndefined();
  });

  it('start/stop schedules ticks on the interval; 0 disables', async () => {
    vi.useFakeTimers();
    const getOpenCalls = vi.fn(() => [] as OpenCall[]);
    const poller = createOutcomePoller({ source: fakeSource({}), intervalMs: 60_000, getOpenCalls, onOutcome: () => {} });
    poller.start();
    expect(poller.running).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getOpenCalls).toHaveBeenCalledTimes(2);
    poller.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(getOpenCalls).toHaveBeenCalledTimes(2);

    const off = createOutcomePoller({ source: fakeSource({}), intervalMs: 0, getOpenCalls, onOutcome: () => {} });
    off.start();
    expect(off.running).toBe(false);
  });

  it('does not overlap passes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const getOpenCalls = vi.fn(async () => {
      await gate;
      return [] as OpenCall[];
    });
    const poller = createOutcomePoller({ source: fakeSource({}), intervalMs: 1, getOpenCalls, onOutcome: () => {} });
    const a = poller.tick();
    const b = poller.tick();
    release();
    await Promise.all([a, b]);
    expect(getOpenCalls).toHaveBeenCalledTimes(1);
  });
});
