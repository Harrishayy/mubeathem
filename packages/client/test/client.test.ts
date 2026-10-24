import { demoEvents, reduceCall, type CallEvent, type CallView } from '@cue/core';
import { describe, expect, it, vi } from 'vitest';
import { createCueApi, CueApiError } from '../src/api';
import { TurnBuffer } from '../src/buffer';
import { subscribeCall, type Connection, type EventSourceLike } from '../src/stream';
import { TypedTranscriber, WebSpeechTranscriber, type SpeechRecognitionLike, type TranscriberTurn } from '../src/transcriber';

const events = demoEvents();
const callId = events[0]!.callId;
const fullView = reduceCall(events);

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createCueApi', () => {
  it('sends the token, parses responses with the core schema', async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`http://cue.test/api/calls/${callId}`);
      expect((init!.headers as Record<string, string>)['x-cue-token']).toBe('tok');
      return jsonRes(fullView);
    });
    const api = createCueApi({ baseUrl: 'http://cue.test/', token: 'tok', fetch: fetch as typeof globalThis.fetch });
    const v = await api.getCall(callId);
    expect(v.id).toBe(callId);
    expect(api.streamUrl(callId, 7)).toBe(`http://cue.test/api/calls/${callId}/stream?after=7&token=tok`);
  });

  it('turns ApiError bodies into CueApiError with code and status', async () => {
    const api = createCueApi({ baseUrl: 'http://cue.test', fetch: (async () => jsonRes({ error: { code: 'call_ended', message: 'The call has ended' } }, 409)) as typeof fetch });
    const err = await api.addTurn(callId, { speaker: 'prospect', text: 'hi' }).catch((e) => e);
    expect(err).toBeInstanceOf(CueApiError);
    expect(err.code).toBe('call_ended');
    expect(err.status).toBe(409);
    expect(err.retryable).toBe(false);
  });

  it('rejects responses that break the contract as bad_response', async () => {
    const api = createCueApi({ baseUrl: 'http://cue.test', fetch: (async () => jsonRes({ id: 42 })) as typeof fetch });
    const err = await api.getCall(callId).catch((e) => e);
    expect(err.code).toBe('bad_response');
    const notJson = createCueApi({ baseUrl: 'http://cue.test', fetch: (async () => new Response('<html>', { status: 200 })) as typeof fetch });
    expect((await notJson.health().catch((e) => e)).code).toBe('bad_response');
  });

  it('reports network failures and timeouts as retryable', async () => {
    const down = createCueApi({ baseUrl: 'http://cue.test', fetch: (async () => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch });
    const e1 = await down.health().catch((e) => e);
    expect(e1.code).toBe('network');
    expect(e1.retryable).toBe(true);
    const slow = createCueApi({
      baseUrl: 'http://cue.test',
      timeoutMs: 20,
      fetch: ((_u: unknown, init?: RequestInit) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch,
    });
    const e2 = await slow.health().catch((e) => e);
    expect(e2.code).toBe('timeout');
    expect(e2.retryable).toBe(true);
  });

  it('204 resolves to undefined', async () => {
    const api = createCueApi({ baseUrl: 'http://cue.test', fetch: (async () => new Response(null, { status: 204 })) as typeof fetch });
    await expect(api.suggestionAction(callId, 'sug_1', { action: 'used' })).resolves.toBeUndefined();
  });
});

/* ───────── fake EventSource ───────── */

class FakeES implements EventSourceLike {
  static all: FakeES[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((ev: { data: string }) => void)[]>();
  constructor(readonly url: string) {
    FakeES.all.push(this);
  }
  addEventListener(type: string, l: (ev: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.({});
  }
  fail() {
    this.onerror?.({});
  }
  view(v: CallView) {
    for (const l of this.listeners.get('view') ?? []) l({ data: JSON.stringify({ kind: 'view', view: v }) });
  }
  event(e: CallEvent) {
    for (const l of this.listeners.get('event') ?? []) l({ data: JSON.stringify({ kind: 'event', event: e }) });
  }
}

function manualTimers() {
  const pending: { fn: () => void; ms: number }[] = [];
  return {
    pending,
    setTimeout: (fn: () => void, ms: number) => pending.push({ fn, ms }),
    clearTimeout: () => {},
    runNext() {
      pending.shift()?.fn();
    },
  };
}

describe('subscribeCall', () => {
  it('applies the snapshot then events, reconnects with backoff, resumes from the last seq and refetches the view', async () => {
    FakeES.all = [];
    const split = 6;
    const snapshot = reduceCall(events.slice(0, split));
    const getCall = vi.fn(async () => reduceCall(events.slice(0, split + 2)));
    const api = { ...createCueApi({ baseUrl: 'http://cue.test' }), getCall };
    const timers = manualTimers();
    const states: Connection[] = [];
    const views: CallView[] = [];
    const unsub = subscribeCall(api, callId, { onView: (v) => views.push(v), onConnection: (s) => states.push(s) }, { EventSource: FakeES, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });

    const first = FakeES.all[0]!;
    expect(first.url).not.toContain('after=');
    first.open();
    first.view(snapshot);
    first.event(events[split]!);
    first.event(events[split]!); // duplicate ignored
    expect(views.at(-1)!.lastSeq).toBe(events[split]!.seq);

    first.fail();
    first.fail(); // ignored: already closed
    expect(first.closed).toBe(true);
    expect(states).toEqual(['live', 'reconnecting']);
    expect(timers.pending[0]!.ms).toBe(500);
    timers.runNext();
    const second = FakeES.all[1]!;
    expect(second.url).toContain(`after=${events[split]!.seq}`);
    second.fail();
    expect(timers.pending[0]!.ms).toBe(1000);
    timers.runNext();
    const third = FakeES.all[2]!;
    third.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(getCall).toHaveBeenCalledTimes(1);
    expect(views.at(-1)!.lastSeq).toBe(events[split + 1]!.seq);
    // resumed events at or below the refetched seq are ignored; newer ones apply
    third.event(events[split + 1]!);
    for (const e of events.slice(split + 2)) third.event(e);
    expect(views.at(-1)).toEqual(fullView);
    expect(states.at(-1)).toBe('live');
    unsub();
    expect(third.closed).toBe(true);
  });

  it('goes offline after repeated failures and caps backoff at 8 s', () => {
    FakeES.all = [];
    const timers = manualTimers();
    const states: Connection[] = [];
    subscribeCall(createCueApi({ baseUrl: 'http://cue.test' }), callId, { onView: () => {}, onConnection: (s) => states.push(s) }, { EventSource: FakeES, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      FakeES.all.at(-1)!.fail();
      delays.push(timers.pending[0]!.ms);
      timers.runNext();
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
    expect(states).toContain('offline');
  });
});

describe('TurnBuffer', () => {
  it('replays queued turns in order with their original ids after an outage', async () => {
    let online = false;
    const sent: string[] = [];
    const timers = manualTimers();
    const buf = new TurnBuffer({
      send: async (_c, t) => {
        if (!online) throw new CueApiError('network', 0, 'down');
        sent.push(`${t.id}:${t.text}`);
      },
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    const a = buf.push('call_1', { speaker: 'prospect', text: 'one' });
    const b = buf.push('call_1', { id: 'turn_fixed', speaker: 'rep', text: 'two' });
    buf.push('call_1', { id: 'turn_i', speaker: 'prospect', text: 'thr', final: false });
    buf.push('call_1', { id: 'turn_i', speaker: 'prospect', text: 'three', final: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(buf.isOffline).toBe(true);
    expect(buf.pending).toBe(3);
    online = true;
    timers.runNext();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([`${a}:one`, `${b}:two`, 'turn_i:three']);
    expect(b).toBe('turn_fixed');
    expect(buf.pending).toBe(0);
    expect(buf.isOffline).toBe(false);
  });

  it('drops a turn the server refuses (4xx) and keeps going', async () => {
    const dropped: string[] = [];
    const sent: string[] = [];
    const buf = new TurnBuffer({
      send: async (_c, t) => {
        if (t.text === 'bad') throw new CueApiError('invalid_request', 400, 'no');
        sent.push(t.text);
      },
      onDrop: (i) => dropped.push(i.turn.text),
    });
    buf.push('c', { speaker: 'rep', text: 'bad' });
    buf.push('c', { speaker: 'rep', text: 'good' });
    await new Promise((r) => setTimeout(r, 0));
    expect(dropped).toEqual(['bad']);
    expect(sent).toEqual(['good']);
  });
});

describe('transcribers', () => {
  it('TypedTranscriber emits final turns with offsets', async () => {
    let now = 1000;
    const t = new TypedTranscriber({ speaker: 'rep', now: () => now });
    const turns: TranscriberTurn[] = [];
    t.on('turn', (x) => turns.push(x));
    expect(t.say('ignored before start')).toBeNull();
    await t.start();
    now = 3500;
    t.say('Hi Maya', 'rep');
    expect(turns[0]).toMatchObject({ speaker: 'rep', text: 'Hi Maya', final: true, tMs: 2500, via: 'typed' });
  });

  class FakeRec implements SpeechRecognitionLike {
    static last: FakeRec | null = null;
    lang = '';
    continuous = false;
    interimResults = false;
    onresult: SpeechRecognitionLike['onresult'] = null;
    onerror: SpeechRecognitionLike['onerror'] = null;
    onend: SpeechRecognitionLike['onend'] = null;
    onstart: SpeechRecognitionLike['onstart'] = null;
    onsoundstart: SpeechRecognitionLike['onsoundstart'] = null;
    onsoundend: SpeechRecognitionLike['onsoundend'] = null;
    starts = 0;
    aborted = false;
    constructor() {
      FakeRec.last = this;
    }
    start() {
      this.starts++;
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.aborted = true;
    }
  }
  const result = (text: string, isFinal: boolean) => ({ resultIndex: 0, results: { length: 1, 0: Object.assign([{ transcript: text }], { isFinal }) } }) as never;

  it('WebSpeechTranscriber streams interim + final under one id and restarts on end', async () => {
    let now = 0;
    const timers = manualTimers();
    const t = new WebSpeechTranscriber({ speaker: 'prospect', recognition: FakeRec, callStartedAt: 0, now: () => now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    const turns: TranscriberTurn[] = [];
    const states: string[] = [];
    t.on('turn', (x) => turns.push(x));
    t.on('state', (s) => states.push(s));
    await t.start();
    const rec = FakeRec.last!;
    rec.onresult!(result("what's this", false));
    rec.onresult!(result("what's this regarding?", true));
    rec.onresult!(result('hello', false));
    expect(turns[0]!.id).toBe(turns[1]!.id);
    expect(turns[1]!.final).toBe(true);
    expect(turns[2]!.id).not.toBe(turns[1]!.id);
    now = 5000; // a long session ending on silence restarts at once
    rec.onend!();
    expect(rec.starts).toBe(2);
    expect(timers.pending).toHaveLength(0);
    rec.onend!(); // ended again within 1 s: no tight loop, restart after a pause
    expect(rec.starts).toBe(2);
    expect(timers.pending[0]!.ms).toBe(1000);
    timers.runNext();
    expect(rec.starts).toBe(3);
    t.stop();
    expect(states.at(-1)).toBe('stopped');
  });

  it('retryable errors back off 1 → 30 s, reset on speech, and give up after 5 in a row', async () => {
    let now = 0;
    const timers = manualTimers();
    const t = new WebSpeechTranscriber({ speaker: 'rep', recognition: FakeRec, now: () => now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    const errors: { code: string; fatal: boolean }[] = [];
    const states: string[] = [];
    t.on('error', (e) => errors.push(e));
    t.on('state', (s) => states.push(s));
    await t.start();
    const rec = FakeRec.last!;
    const fail = (code: string) => {
      rec.onerror!({ error: code });
      rec.onend!();
    };
    const delays: number[] = [];
    for (const code of ['network', 'network', 'not-allowed', 'service-not-allowed']) {
      fail(code);
      delays.push(timers.pending[0]!.ms);
      timers.runNext();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
    expect(errors.every((e) => !e.fatal)).toBe(true);
    // Real speech resets the streak.
    rec.onsoundstart!();
    fail('network');
    expect(timers.pending[0]!.ms).toBe(1000);
    timers.runNext();
    for (let i = 0; i < 3; i++) {
      fail('network');
      timers.runNext();
    }
    const startsBefore = rec.starts;
    fail('network'); // 5th consecutive
    expect(errors.at(-1)).toMatchObject({ code: 'network', fatal: true });
    expect(states.at(-1)).toBe('unavailable');
    expect(timers.pending).toHaveLength(0);
    expect(rec.starts).toBe(startsBefore);
    expect(rec.aborted).toBe(true);
  });

  it('caps the backoff at 30 s and treats audio-capture as fatal at once', async () => {
    const timers = manualTimers();
    const t = new WebSpeechTranscriber({ speaker: 'rep', recognition: FakeRec, maxFailures: 10, now: () => 0, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    await t.start();
    const rec = FakeRec.last!;
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      rec.onerror!({ error: 'network' });
      rec.onend!();
      delays.push(timers.pending[0]!.ms);
      timers.runNext();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);

    const states: string[] = [];
    const t2 = new WebSpeechTranscriber({ speaker: 'rep', recognition: FakeRec, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    t2.on('state', (s) => states.push(s));
    await t2.start();
    FakeRec.last!.onerror!({ error: 'audio-capture' });
    expect(states.at(-1)).toBe('error');
  });
});
