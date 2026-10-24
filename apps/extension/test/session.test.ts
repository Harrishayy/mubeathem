import { CueApiError, type CueApi, type SubscribeHandlers } from '@cue/client';
import { emptyView, type CallView, type Prospect } from '@cue/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session, type SessionDeps } from '../src/background/session';
import type { Broadcast, SessionState } from '../src/messages';
import { defaultSettings, type StorageAreaLike } from '../src/settings';

const PROSPECT: Prospect = { name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs', phone: '+14155550142', facts: {} };

function view(id: string, patch: Partial<CallView> = {}): CallView {
  return { ...emptyView(id), status: 'live', startedAt: 1_000, prospect: PROSPECT, rep: { id: 'rep_1', name: 'Alex' }, lastSeq: 1, ...patch };
}

const offline = () => new CueApiError('network', 0, 'Failed to fetch');

function memoryStore(): StorageAreaLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(keys) {
      const ks = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(ks.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
  };
}

function fakeApi() {
  return {
    createCall: vi.fn(async () => view('call_1')),
    addTurn: vi.fn(async (_id: string, t: { id?: string }) => ({ turnId: t.id ?? 'x' })),
    endCall: vi.fn(async (id: string, req?: { outcome?: string }) => view(id, { status: 'ended', endedAt: 2_000, lastSeq: 5, outcome: req?.outcome ? { outcome: req.outcome as never, source: 'rep', raw: {}, at: 2_000 } : null })),
    suggestionAction: vi.fn(async () => undefined),
    feedback: vi.fn(async (id: string) => view(id, { status: 'ended', lastSeq: 9 })),
  };
}

function setup(over: Partial<SessionDeps> = {}, api = fakeApi(), store = memoryStore()) {
  const states: SessionState[] = [];
  const subs: { callId: string; handlers: SubscribeHandlers; closed: boolean }[] = [];
  const capture = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
  const deps: SessionDeps = {
    loadSettings: async () => ({ ...defaultSettings(), rep: { id: 'rep_1', name: 'Alex' } }),
    makeApi: () => api as unknown as CueApi,
    subscribe: (_a, callId, handlers) => {
      const s = { callId, handlers, closed: false };
      subs.push(s);
      return () => (s.closed = true);
    },
    startCapture: capture.start,
    stopCapture: capture.stop,
    broadcast: (b: Broadcast) => b.type === 'state' && states.push(b.state),
    store,
    ...over,
  };
  const session = new Session(deps);
  return { session, api, store, states, subs, capture };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Session', () => {
  it('starts a call, captures the tab, follows the stream', async () => {
    const { session, api, subs, capture } = setup();
    await session.init();
    const s = await session.start({ prospect: PROSPECT, tabId: 7, source: 'trellus' });
    expect(api.createCall).toHaveBeenCalledWith({ source: 'trellus', prospect: PROSPECT, rep: { id: 'rep_1', name: 'Alex' } });
    expect(s).toMatchObject({ phase: 'live', callId: 'call_1', tabId: 7 });
    expect(capture.start).toHaveBeenCalledWith(7, expect.any(Number));
    expect(subs).toHaveLength(1);
    // Starting again while live is a no-op.
    await session.start({ prospect: PROSPECT, tabId: 7 });
    expect(api.createCall).toHaveBeenCalledTimes(1);
  });

  it('passes the saved contact to the server and keeps it across a worker restart', async () => {
    const store = memoryStore();
    const first = setup({}, fakeApi(), store);
    first.api.createCall.mockRejectedValueOnce(offline());
    await first.session.init();
    await first.session.start({ prospect: { name: '', title: '', company: '', facts: {} }, tabId: 7, contactId: 'contact_1' });
    expect(first.api.createCall).toHaveBeenLastCalledWith(expect.objectContaining({ contactId: 'contact_1' }));
    await vi.advanceTimersByTimeAsync(60);
    // The worker restarts before the server answered: the retry still names the contact.
    const second = setup({}, fakeApi(), store);
    await second.session.init();
    expect(second.api.createCall).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'contact_1' }));
  });

  it('relays turns and drops interims before the call exists', async () => {
    const { session, api } = setup();
    await session.init();
    expect(session.typedTurn('prospect', 'hello')).toBeNull(); // no call yet
    await session.start({ prospect: PROSPECT, tabId: 1 });
    const id = session.typedTurn('prospect', "  What's this regarding?  ");
    await vi.runOnlyPendingTimersAsync();
    expect(api.addTurn).toHaveBeenCalledWith('call_1', expect.objectContaining({ id, speaker: 'prospect', text: "What's this regarding?", final: true, via: 'typed' }));
  });

  it('keeps turns while the server is unreachable and replays them in order with their ids', async () => {
    const api = fakeApi();
    let down = true;
    api.addTurn.mockImplementation(async (_id, t) => {
      if (down) throw offline();
      return { turnId: t.id! };
    });
    const { session, states } = setup({}, api);
    await session.init();
    await session.start({ prospect: PROSPECT, tabId: 1 });
    const ids = ['one', 'two', 'three'].map((t) => session.typedTurn('prospect', t));
    await vi.advanceTimersByTimeAsync(100);
    expect(session.snapshot.pendingTurns).toBe(3);
    expect(session.snapshot.connection).toBe('reconnecting');
    expect(states.at(-1)?.error).toMatch(/Can't reach/);
    down = false;
    await vi.advanceTimersByTimeAsync(10_000);
    const sent = api.addTurn.mock.calls.filter((c) => !down && c).map((c) => (c[1] as { id: string }).id);
    expect(sent.slice(-3)).toEqual(ids);
    expect(session.snapshot.pendingTurns).toBe(0);
    expect(session.snapshot.error).toBeNull();
  });

  it('starts offline: queues turns locally, creates the call when the server is back, then replays', async () => {
    const api = fakeApi();
    api.createCall.mockRejectedValueOnce(offline()).mockRejectedValueOnce(offline());
    const { session } = setup({}, api);
    await session.init();
    await session.start({ prospect: PROSPECT, tabId: 1 });
    expect(session.snapshot).toMatchObject({ phase: 'starting', connection: 'offline', callId: null });
    const a = session.typedTurn('prospect', 'first');
    const b = session.typedTurn('rep', 'second');
    expect(session.snapshot.pendingTurns).toBe(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(api.createCall).toHaveBeenCalledTimes(3);
    expect(session.snapshot).toMatchObject({ phase: 'live', callId: 'call_1' });
    expect(api.addTurn.mock.calls.map((c) => (c[1] as { id: string }).id)).toEqual([a, b]);
  });

  it('a refused token ends the attempt with a plain message and stops capture', async () => {
    const api = fakeApi();
    api.createCall.mockRejectedValue(new CueApiError('unauthorized', 401, 'Missing or wrong x-cue-token'));
    const { session, capture } = setup({}, api);
    await session.init();
    await session.start({ prospect: PROSPECT, tabId: 1 });
    expect(session.snapshot.phase).toBe('idle');
    expect(session.snapshot.error).toMatch(/token/);
    expect(capture.stop).toHaveBeenCalled();
  });

  it('survives a service-worker restart: picks the call back up and replays unacknowledged turns', async () => {
    const store = memoryStore();
    const api1 = fakeApi();
    api1.addTurn.mockRejectedValue(offline());
    const first = setup({}, api1, store);
    await first.session.init();
    await first.session.start({ prospect: PROSPECT, tabId: 3 });
    const id = first.session.typedTurn('prospect', 'kept across restarts');
    await vi.advanceTimersByTimeAsync(200);

    const api2 = fakeApi();
    const second = setup({}, api2, store);
    await second.session.init();
    expect(second.session.snapshot).toMatchObject({ phase: 'live', callId: 'call_1', tabId: 3 });
    expect(second.subs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(api2.addTurn).toHaveBeenCalledWith('call_1', expect.objectContaining({ id, text: 'kept across restarts' }));
  });

  it('ends with an outcome after flushing turns, and the debrief goes to the server', async () => {
    const { session, api, capture } = setup();
    await session.init();
    await session.start({ prospect: PROSPECT, tabId: 1 });
    session.typedTurn('prospect', 'Thursday works');
    const s = await session.end('meeting_booked');
    expect(api.addTurn).toHaveBeenCalled();
    expect(api.endCall).toHaveBeenCalledWith('call_1', { outcome: 'meeting_booked' });
    expect(s.phase).toBe('ended');
    expect(s.view?.outcome?.outcome).toBe('meeting_booked');
    expect(capture.stop).toHaveBeenCalled();
    await session.feedback({ outcome: 'meeting_booked', helpful: [], unhelpful: [] });
    expect(api.feedback).toHaveBeenCalled();
    session.reset();
    expect(session.snapshot.phase).toBe('idle');
  });

  it('stops capture when the server ends the call (another surface, or the Trellus poller)', async () => {
    const { session, subs, capture } = setup();
    await session.init();
    await session.start({ prospect: PROSPECT, tabId: 1 });
    subs[0]!.handlers.onView(view('call_1', { status: 'ended', lastSeq: 4 }));
    expect(session.snapshot.phase).toBe('ended');
    expect(capture.stop).toHaveBeenCalled();
    // Older views never roll the state back.
    subs[0]!.handlers.onView(view('call_1', { status: 'live', lastSeq: 2 }));
    expect(session.snapshot.phase).toBe('ended');
  });

  it('pauses and resumes listening without ending the call', async () => {
    const { session, capture } = setup();
    await session.init();
    await session.stopCapture(); // idle: nothing to stop
    expect(capture.stop).not.toHaveBeenCalled();
    await session.start({ prospect: PROSPECT, tabId: 4 });
    session.captureStatus('mic', { state: 'on' });
    await session.stopCapture();
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(session.snapshot).toMatchObject({ phase: 'live', capture: { tab: { state: 'off' }, mic: { state: 'off' } } });
    await session.retryCapture();
    expect(capture.start).toHaveBeenLastCalledWith(4, expect.any(Number));
  });

  it('auto-starts on a Trellus connect unless the setting is off', async () => {
    const off = setup({ loadSettings: async () => ({ ...defaultSettings(), autoStart: false, rep: { id: 'rep_1', name: 'Alex' } }) });
    await off.session.init();
    const ctx = (state: 'idle' | 'connected') => ({ tabId: 4, host: 'app.hubspot.com', prospect: PROSPECT, trellus: { present: true, state } });
    await off.session.pageContext(ctx('idle'));
    await off.session.pageContext(ctx('connected'));
    expect(off.api.createCall).not.toHaveBeenCalled();

    const on = setup({ loadSettings: async () => ({ ...defaultSettings(), autoStart: true, rep: { id: 'rep_1', name: 'Alex' } }) });
    await on.session.init();
    await on.session.pageContext(ctx('idle'));
    await on.session.pageContext(ctx('connected'));
    expect(on.api.createCall).toHaveBeenCalledWith(expect.objectContaining({ source: 'trellus' }));
    expect(on.session.snapshot.tabId).toBe(4);
  });

  it('forgets the contact when its tab closes, and only that tab', async () => {
    const { session } = setup();
    await session.init();
    await session.pageContext({ tabId: 4, host: 'app.hubspot.com', prospect: PROSPECT, trellus: { present: false, state: 'none' } });
    session.pageGone(5);
    expect(session.snapshot.page?.prospect?.name).toBe('Maya Chen');
    session.pageGone(4);
    expect(session.snapshot.page).toBeNull();
  });

  it('a Trellus sub-frame reading merges into the tab without wiping the CRM contact', async () => {
    const { session } = setup();
    await session.init();
    await session.pageContext({ tabId: 4, host: 'app.hubspot.com', prospect: PROSPECT, trellus: { present: false, state: 'none' } });
    await session.pageContext({ tabId: 4, host: 'app.trellus.ai', prospect: null, trellus: { present: true, state: 'dialing' } });
    expect(session.snapshot.page).toMatchObject({ prospect: { name: 'Maya Chen' }, trellus: { present: true, state: 'dialing' } });
  });
});
