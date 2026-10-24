import { applyEvent, StreamMessage, type CallEvent, type CallView } from '@cue/core';
import type { CueApi } from './api';

export type Connection = 'live' | 'reconnecting' | 'offline';

/** The subset of the DOM EventSource this module uses, so tests (and non-browser hosts) can inject one. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (ev: { data: string; lastEventId?: string }) => void): void;
  onopen: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}
export type EventSourceCtor = new (url: string) => EventSourceLike;

export interface SubscribeHandlers {
  /** Every time the view changes: the snapshot, each applied event, a refetch after reconnect. */
  onView(view: CallView): void;
  onEvent?(event: CallEvent, view: CallView): void;
  onConnection?(state: Connection): void;
  onError?(error: unknown): void;
}

export interface SubscribeOptions {
  EventSource?: EventSourceCtor;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Failed reconnects before the state reads `offline` (it keeps retrying at the max backoff). */
  offlineAfter?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (t: unknown) => void;
}

/**
 * Live view of one call over SSE. Reconnects itself with backoff 0.5 → 8 s, resuming from the last
 * applied seq (`?after=`), then refetches the view to be sure nothing was missed. Events at or below
 * the current seq are ignored, so a resume can never apply one twice. Returns an unsubscribe function.
 */
export function subscribeCall(api: CueApi, callId: string, handlers: SubscribeHandlers, opts: SubscribeOptions = {}): () => void {
  const ES = opts.EventSource ?? (globalThis as unknown as { EventSource?: EventSourceCtor }).EventSource;
  if (!ES) throw new Error('No EventSource available; pass opts.EventSource');
  const min = opts.minBackoffMs ?? 500;
  const max = opts.maxBackoffMs ?? 8000;
  const offlineAfter = opts.offlineAfter ?? 4;
  const setT = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

  let view: CallView | null = null;
  let lastSeq = -1;
  let es: EventSourceLike | null = null;
  let failures = 0;
  let everOpened = false;
  let timer: unknown = null;
  let closed = false;
  let state: Connection | null = null;

  const setState = (s: Connection) => {
    if (s === state) return;
    state = s;
    handlers.onConnection?.(s);
  };
  const report = (e: unknown) => {
    try {
      handlers.onError?.(e);
    } catch {
      /* ignore */
    }
  };

  const takeView = (v: CallView) => {
    if (v.lastSeq < lastSeq) return;
    view = v;
    lastSeq = v.lastSeq;
    handlers.onView(v);
  };

  const onMessage = (ev: { data: string }) => {
    if (closed) return;
    let msg: StreamMessage;
    try {
      msg = StreamMessage.parse(JSON.parse(ev.data));
    } catch (e) {
      report(e);
      return;
    }
    if (msg.kind === 'view') return takeView(msg.view);
    const e = msg.event;
    if (!view || e.seq <= lastSeq) return;
    view = applyEvent(view, e);
    lastSeq = e.seq;
    handlers.onEvent?.(e, view);
    handlers.onView(view);
  };

  const connect = () => {
    if (closed) return;
    const resume = view !== null;
    const source = new ES(api.streamUrl(callId, resume ? lastSeq : undefined));
    es = source;
    source.addEventListener('view', onMessage);
    source.addEventListener('event', onMessage);
    source.onopen = () => {
      if (closed || es !== source) return;
      const wasReconnect = everOpened || failures > 0;
      everOpened = true;
      failures = 0;
      setState('live');
      if (wasReconnect && resume)
        api
          .getCall(callId)
          .then((v) => !closed && takeView(v))
          .catch(report);
    };
    source.onerror = () => {
      if (closed || es !== source) return;
      // Take reconnection into our own hands so we control backoff and the resume point.
      source.close();
      es = null;
      failures++;
      setState(failures >= offlineAfter ? 'offline' : 'reconnecting');
      const delay = Math.min(max, min * 2 ** (failures - 1));
      timer = setT(connect, delay);
    };
  };

  connect();

  return () => {
    closed = true;
    if (timer !== null) clearT(timer);
    es?.close();
    es = null;
  };
}
