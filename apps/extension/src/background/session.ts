import { CueApiError, TurnBuffer, type Connection, type CueApi, type SubscribeHandlers, type TurnInput } from '@cue/client';
import { newId, type CallView, type FeedbackRequest, type Outcome, type Prospect, type Speaker, type SuggestionAction } from '@cue/core';
import { justConnected, justEnded } from '../context/trellus';
import { initialState, type Broadcast, type CaptureStatus, type Levels, type PageContext, type SessionState } from '../messages';
import type { Settings, StorageAreaLike } from '../settings';

/** What the session needs from the outside world; all injectable so it is tested without Chrome. */
export interface SessionDeps {
  loadSettings(): Promise<Settings>;
  makeApi(s: Settings): CueApi;
  subscribe(api: CueApi, callId: string, handlers: SubscribeHandlers): () => void;
  /** Starts capture on the call tab; resolves once it has been asked (status arrives as events). */
  startCapture(tabId: number | null, callStartedAt: number): Promise<void>;
  stopCapture(): Promise<void>;
  setMicSpeaker?(s: Speaker): Promise<void>;
  broadcast(b: Broadcast): void;
  /** chrome.storage.session: survives a service-worker restart, not a browser restart. */
  store: StorageAreaLike;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (t: unknown) => void;
}

interface Persisted {
  phase: SessionState['phase'];
  callId: string | null;
  tabId: number | null;
  startedAt: number | null;
  source: 'trellus' | 'cue';
  prospect: Prospect | null;
  /** The saved contact being called, when the call was started from one. */
  contactId?: string | null;
  /** Final turns not yet acknowledged by the server, oldest first. */
  turns: { callId: string | null; turn: TurnInput & { id: string } }[];
  /** An end the server hasn't confirmed yet. */
  endPending: { outcome?: Outcome } | null;
}

const KEY = 'cue.session';
const OFFLINE_MSG = "Can't reach the Cue server. Your turns are kept and sent when it's back.";

function message(e: unknown): string {
  if (e instanceof CueApiError) {
    if (e.status === 401) return 'The Cue server refused the token. Check it in Settings.';
    if (e.code === 'network' || e.code === 'timeout') return OFFLINE_MSG;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

const retryable = (e: unknown) => e instanceof CueApiError && e.retryable;

/**
 * The call session. Lives in the background service worker: creates the call on the server, starts
 * capture, relays turns through a TurnBuffer (replayed in order with their ids when the server was
 * unreachable, and persisted so a worker restart doesn't lose them), follows the SSE stream and
 * broadcasts one SessionState to every surface.
 */
export class Session {
  private state: SessionState = initialState();
  private api: CueApi | null = null;
  private settings: Settings | null = null;
  private buffer: TurnBuffer;
  private unsubscribe: (() => void) | null = null;
  private streamConn: Connection = 'live';
  private startedAt: number | null = null;
  private source: 'trellus' | 'cue' = 'cue';
  private prospect: Prospect | null = null;
  private contactId: string | null = null;
  /** Turns said before the server gave us a call id. */
  private preCall: (TurnInput & { id: string })[] = [];
  /** Final turns sent but not acknowledged, for persistence. */
  private unacked = new Map<string, { callId: string; turn: TurnInput & { id: string } }>();
  private endPending: { outcome?: Outcome } | null = null;
  private retryTimer: unknown = null;
  private retries = 0;
  private persistTimer: unknown = null;
  private readonly now: () => number;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (t: unknown) => void;

  constructor(private deps: SessionDeps) {
    this.now = deps.now ?? Date.now;
    this.setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = deps.clearTimeout ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    this.buffer = this.makeBuffer();
  }

  get snapshot(): SessionState {
    return this.state;
  }

  /* ───────── lifecycle ───────── */

  async init(): Promise<void> {
    this.settings = await this.deps.loadSettings();
    this.api = this.deps.makeApi(this.settings);
    await this.restore();
  }

  /** Settings changed: rebuild the API client and resubscribe if a call is live. */
  async applySettings(s: Settings): Promise<void> {
    const changed = !this.settings || s.serverUrl !== this.settings.serverUrl || s.token !== this.settings.token;
    this.settings = s;
    if (!changed) return;
    this.api = this.deps.makeApi(s);
    if (this.state.callId && this.state.phase !== 'idle') this.follow(this.state.callId);
    void this.buffer.flush();
  }

  async start(input: { prospect: Prospect; tabId?: number | null; source?: 'trellus' | 'cue'; contactId?: string }): Promise<SessionState> {
    if (this.state.phase === 'starting' || this.state.phase === 'live') return this.state;
    this.reset(false);
    this.startedAt = this.now();
    this.source = input.source ?? 'cue';
    this.prospect = input.prospect;
    this.contactId = input.contactId ?? null;
    this.set({ phase: 'starting', tabId: input.tabId ?? this.state.page?.tabId ?? null, error: null });
    void this.deps.startCapture(this.state.tabId, this.startedAt).catch((e) => this.captureStatus('tab', { state: 'error', message: message(e) }));
    await this.createCall();
    return this.state;
  }

  async end(outcome?: Outcome): Promise<SessionState> {
    if (this.state.phase === 'idle') return this.state;
    void this.deps.stopCapture();
    this.set({ capture: { tab: { state: 'off' }, mic: { state: 'off' } } });
    if (!this.state.callId) {
      // Never reached the server: nothing to end there. Drop the local call.
      this.preCall = [];
      this.cancelRetry();
      this.set({ phase: 'idle', error: this.state.connection === 'offline' ? 'The call never reached the Cue server, so there is nothing to debrief.' : null });
      this.persist();
      return this.state;
    }
    this.endPending = outcome ? { outcome } : {};
    this.set({ phase: 'ended' });
    await this.buffer.flush();
    await this.sendEnd();
    return this.state;
  }

  /** After the debrief (or skipping it): back to idle. */
  reset(broadcast = true): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.cancelRetry();
    if (this.state.callId) this.buffer.clear(this.state.callId);
    this.preCall = [];
    this.unacked.clear();
    this.endPending = null;
    this.startedAt = null;
    this.prospect = null;
    this.contactId = null;
    this.streamConn = 'live';
    const { page, micSpeaker } = this.state;
    this.state = { ...initialState(), page, micSpeaker };
    this.persist();
    if (broadcast) this.emit();
  }

  /* ───────── turns, actions, feedback ───────── */

  /** A turn from the transcriber (interim or final). Returns its id, or null with no call. */
  addTurn(turn: TurnInput & { id: string }): string | null {
    if (this.state.phase === 'idle' || this.state.phase === 'ended') return null;
    if (!this.state.callId) {
      if (turn.final === false) return null; // interims before the call exists are noise
      this.preCall = [...this.preCall.filter((t) => t.id !== turn.id), turn];
      this.set({ pendingTurns: this.preCall.length });
      this.persist();
      return turn.id;
    }
    return this.enqueue(this.state.callId, turn);
  }

  private enqueue(callId: string, turn: TurnInput & { id: string }): string {
    if (turn.final !== false) this.unacked.set(turn.id, { callId, turn });
    this.buffer.push(callId, turn);
    this.persist();
    return turn.id;
  }

  typedTurn(speaker: Speaker, text: string): string | null {
    const t = text.trim().slice(0, 4000);
    if (!t) return null;
    const tMs = Math.max(0, this.now() - (this.state.view?.startedAt ?? this.startedAt ?? this.now()));
    return this.addTurn({ id: newId('turn'), speaker, text: t, tMs, final: true, via: 'typed' });
  }

  async action(suggestionId: string, action: SuggestionAction, text?: string): Promise<void> {
    const callId = this.state.callId;
    if (!callId || !this.api) throw new Error('No call');
    try {
      await this.api.suggestionAction(callId, suggestionId, { action, ...(text ? { text } : {}) });
    } catch (e) {
      this.set({ error: message(e) });
      throw e;
    }
  }

  async feedback(f: FeedbackRequest): Promise<CallView> {
    const callId = this.state.callId;
    if (!callId || !this.api) throw new Error('No call to debrief');
    const view = await this.api.feedback(callId, f);
    this.takeView(view);
    return view;
  }

  /* ───────── capture and page ───────── */

  captureStatus(side: 'tab' | 'mic', status: CaptureStatus): void {
    this.set({ capture: { ...this.state.capture, [side]: status } });
  }

  async setMicSpeaker(speaker: Speaker): Promise<void> {
    this.set({ micSpeaker: speaker });
    await this.deps.setMicSpeaker?.(speaker);
  }

  levels(l: Levels): void {
    this.deps.broadcast({ type: 'levels', levels: l });
  }

  async retryCapture(): Promise<void> {
    if (this.state.phase !== 'live' && this.state.phase !== 'starting') return;
    await this.deps.stopCapture();
    await this.deps.startCapture(this.state.tabId, this.startedAt ?? this.now());
  }

  /** The rep paused listening: stop tab and mic capture but keep the call (typed turns still work). */
  async stopCapture(): Promise<void> {
    if (this.state.phase !== 'live' && this.state.phase !== 'starting') return;
    await this.deps.stopCapture();
    this.set({ capture: { tab: { state: 'off' }, mic: { state: 'off' } } });
  }

  /** The overlay (top frame) or a Trellus frame reported what it sees. Merges, then auto-starts. */
  async pageContext(ctx: PageContext): Promise<void> {
    const prev = this.state.page;
    const sameTab = prev && prev.tabId === ctx.tabId;
    const merged: PageContext = {
      tabId: ctx.tabId,
      host: ctx.host || (sameTab ? prev!.host : ''),
      prospect: ctx.prospect ?? (sameTab ? prev!.prospect : null),
      trellus: ctx.trellus.present || !sameTab ? ctx.trellus : prev!.trellus,
    };
    const before = sameTab ? prev!.trellus.state : 'none';
    this.set({ page: merged });
    const s = this.settings;
    if (!s?.autoStart) return;
    if (justConnected(before, merged.trellus.state) && this.state.phase === 'idle' && merged.prospect) {
      await this.start({ prospect: merged.prospect, tabId: merged.tabId, source: 'trellus' });
    } else if (justEnded(before, merged.trellus.state) && this.state.phase === 'live' && this.state.tabId === merged.tabId) {
      await this.end();
    }
  }

  /** The tab the page context came from closed: stop showing that contact. A call on it carries on. */
  pageGone(tabId: number): void {
    if (this.state.page?.tabId === tabId) this.set({ page: null });
  }

  /* ───────── internals ───────── */

  private makeBuffer(): TurnBuffer {
    return new TurnBuffer({
      send: async (callId, turn) => {
        if (!this.api) throw new CueApiError('network', 0, 'No server configured');
        const r = await this.api.addTurn(callId, turn);
        if (this.unacked.delete(turn.id)) this.persist();
        return r;
      },
      onChange: ({ pending, offline }) => {
        this.set({ pendingTurns: pending + this.preCall.length, ...(offline ? { error: OFFLINE_MSG } : this.state.error === OFFLINE_MSG ? { error: null } : {}) });
        this.recomputeConnection(offline);
      },
      onDrop: ({ turn }, e) => {
        this.unacked.delete(turn.id);
        this.set({ error: `A turn was not accepted: ${message(e)}` });
      },
      setTimeout: this.setT,
      clearTimeout: this.clearT,
    });
  }

  private async createCall(): Promise<void> {
    const api = this.api;
    const s = this.settings;
    if (!api || !s || !this.prospect) return;
    try {
      const view = await api.createCall({
        source: this.source,
        prospect: this.prospect,
        rep: { id: s.rep.id || 'rep_local', name: s.rep.name || 'Rep' },
        ...(this.contactId ? { contactId: this.contactId } : {}),
      });
      if (this.state.phase !== 'starting') return; // ended while we waited
      this.retries = 0;
      this.state = { ...this.state, callId: view.id, phase: 'live', error: null };
      this.takeView(view);
      this.follow(view.id);
      const queued = this.preCall;
      this.preCall = [];
      for (const t of queued) this.enqueue(view.id, t);
      this.recomputeConnection(false);
      this.persist();
    } catch (e) {
      if (this.state.phase !== 'starting') return;
      if (retryable(e)) {
        this.set({ connection: 'offline', error: OFFLINE_MSG });
        this.scheduleRetry(() => this.createCall());
      } else {
        void this.deps.stopCapture();
        this.set({ phase: 'idle', error: message(e), capture: { tab: { state: 'off' }, mic: { state: 'off' } } });
      }
      this.persist();
    }
  }

  private async sendEnd(): Promise<void> {
    const callId = this.state.callId;
    if (!callId || !this.api || !this.endPending) return;
    try {
      const view = await this.api.endCall(callId, this.endPending.outcome ? { outcome: this.endPending.outcome } : {});
      this.endPending = null;
      this.retries = 0;
      this.takeView(view);
      this.set({ error: null });
    } catch (e) {
      if (retryable(e)) {
        this.set({ error: OFFLINE_MSG });
        this.scheduleRetry(() => this.sendEnd());
      } else {
        this.endPending = null;
        this.set({ error: message(e) });
      }
    }
    this.persist();
  }

  private scheduleRetry(fn: () => Promise<void>): void {
    this.cancelRetry();
    const delay = Math.min(8000, 1000 * 2 ** this.retries++);
    this.retryTimer = this.setT(() => {
      this.retryTimer = null;
      void fn();
    }, delay);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) this.clearT(this.retryTimer);
    this.retryTimer = null;
    this.retries = 0;
  }

  private follow(callId: string): void {
    this.unsubscribe?.();
    if (!this.api) return;
    this.unsubscribe = this.deps.subscribe(this.api, callId, {
      onView: (v) => this.takeView(v),
      onConnection: (c) => {
        this.streamConn = c;
        this.recomputeConnection(this.buffer.isOffline);
        // Back online: replay anything still queued straight away rather than at the next backoff.
        if (c === 'live') {
          void this.buffer.flush();
          if (this.endPending) void this.sendEnd();
        }
      },
    });
  }

  private takeView(v: CallView): void {
    if (this.state.callId && v.id !== this.state.callId) return;
    const prev = this.state.view;
    if (prev && v.lastSeq < prev.lastSeq) return;
    const phase = v.status === 'live' ? (this.state.phase === 'ended' ? 'ended' : 'live') : 'ended';
    if (phase === 'ended' && this.state.phase === 'live') {
      // The server ended it (another surface, or the Trellus poller): stop capturing.
      void this.deps.stopCapture();
      this.state = { ...this.state, capture: { tab: { state: 'off' }, mic: { state: 'off' } } };
    }
    this.set({ view: v, phase, callId: v.id });
  }

  private recomputeConnection(bufferOffline: boolean): void {
    let c: Connection = this.streamConn;
    if (this.state.phase === 'starting' && !this.state.callId && this.retryTimer !== null) c = 'offline';
    else if (c === 'live' && bufferOffline) c = 'reconnecting';
    if (c !== this.state.connection) this.set({ connection: c });
  }

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    this.deps.broadcast({ type: 'state', state: this.state });
  }

  private persist(): void {
    if (this.persistTimer !== null) return;
    this.persistTimer = this.setT(() => {
      this.persistTimer = null;
      const data: Persisted = {
        phase: this.state.phase,
        callId: this.state.callId,
        tabId: this.state.tabId,
        startedAt: this.startedAt,
        source: this.source,
        prospect: this.prospect,
        contactId: this.contactId,
        turns: [...this.preCall.map((turn) => ({ callId: null, turn })), ...this.unacked.values()],
        endPending: this.endPending,
      };
      void this.deps.store.set({ [KEY]: data }).catch(() => {});
    }, 50);
  }

  /** After a service-worker restart: pick the call back up, replay unacknowledged turns. */
  private async restore(): Promise<void> {
    let data: Persisted | undefined;
    try {
      data = (await this.deps.store.get(KEY))[KEY] as Persisted | undefined;
    } catch {
      return;
    }
    if (!data || data.phase === 'idle') return;
    this.startedAt = data.startedAt;
    this.source = data.source;
    this.prospect = data.prospect;
    this.contactId = data.contactId ?? null;
    this.endPending = data.endPending;
    this.state = { ...this.state, phase: data.phase, callId: data.callId, tabId: data.tabId };
    if (!data.callId) {
      this.preCall = data.turns.filter((t) => t.callId === null).map((t) => t.turn);
      this.state = { ...this.state, phase: 'starting', pendingTurns: this.preCall.length };
      this.emit();
      await this.createCall();
      return;
    }
    this.emit();
    this.follow(data.callId);
    for (const t of data.turns) if (t.callId === data.callId) this.enqueue(data.callId, t.turn);
    if (this.endPending) void this.sendEnd();
  }
}
