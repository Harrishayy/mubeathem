import { reduceCall, demoEvents, type CallEvent } from '@cue/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCall, callStore, detachCall, onCallEvent, setEventSource } from '../src/state/call';
import { updateSettings } from '../src/state/settings';

/** A fake EventSource the test drives by hand. */
class FakeES {
  static all: FakeES[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  private ls = new Map<string, ((ev: { data: string }) => void)[]>();
  constructor(readonly url: string) {
    FakeES.all.push(this);
  }
  addEventListener(type: string, fn: (ev: { data: string }) => void) {
    this.ls.set(type, [...(this.ls.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, msg: unknown) {
    for (const fn of this.ls.get(type) ?? []) fn({ data: JSON.stringify(msg) });
  }
}

const events = demoEvents();
const callId = events[0]!.callId;

afterEach(() => {
  detachCall();
  FakeES.all = [];
  vi.useRealTimers();
});

describe('call stream', () => {
  it('applies the snapshot then events, and notifies event listeners', () => {
    setEventSource(FakeES as never);
    updateSettings({ serverUrl: 'http://cue.test' });
    const seen: CallEvent['type'][] = [];
    const off = onCallEvent((e) => seen.push(e.type));
    attachCall(callId);
    const es = FakeES.all[0]!;
    expect(es.url).toBe(`http://cue.test/api/calls/${callId}/stream`);
    es.onopen?.({});
    const head = events.slice(0, 10);
    es.emit('view', { kind: 'view', view: reduceCall(head) });
    for (const e of events.slice(10, 20)) es.emit('event', { kind: 'event', event: e });
    // A replayed event is ignored.
    es.emit('event', { kind: 'event', event: events[15] });
    expect(callStore.get().view).toEqual(reduceCall(events.slice(0, 20)));
    expect(seen).toEqual(events.slice(10, 20).map((e) => e.type));
    off();
  });

  it('reconnects with backoff and resumes after the last seq', () => {
    vi.useFakeTimers();
    setEventSource(FakeES as never);
    updateSettings({ serverUrl: 'http://cue.test' });
    attachCall(callId);
    const first = FakeES.all[0]!;
    first.onopen?.({});
    first.emit('view', { kind: 'view', view: reduceCall(events.slice(0, 8)) });
    first.onerror?.({});
    expect(first.closed).toBe(true);
    expect(callStore.get().connection).toBe('reconnecting');
    vi.advanceTimersByTime(600);
    const second = FakeES.all[1]!;
    expect(second.url).toContain(`after=${events[7]!.seq}`);
  });

  it('goes offline after repeated failures', () => {
    vi.useFakeTimers();
    setEventSource(FakeES as never);
    attachCall(callId);
    for (let i = 0; i < 4; i++) {
      FakeES.all.at(-1)!.onerror?.({});
      vi.advanceTimersByTime(10_000);
    }
    expect(callStore.get().connection).toBe('offline');
  });
});
