import { subscribeCall, TurnBuffer, type Connection, type CueApi, type EventSourceCtor, type TurnInput } from '@cue/client';
import type { CallEvent, CallView, Outcome, SuggestionAction } from '@cue/core';
import { getApi } from './api';
import { createStore } from './store';
import { uiStore } from './ui';

export interface CallState {
  callId: string | null;
  view: CallView | null;
  connection: Connection;
  /** Turns waiting for the server (offline buffer). */
  queued: number;
  error: string | null;
}

export const callStore = createStore<CallState>({ callId: null, view: null, connection: 'live', queued: 0, error: null });

type Listener = (e: CallEvent, v: CallView) => void;
const eventListeners = new Set<Listener>();

/** Every applied event of the attached call. */
export function onCallEvent(fn: Listener): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

let unsubscribe: (() => void) | null = null;
let esCtor: EventSourceCtor | undefined;

/** Tests inject a fake EventSource. */
export function setEventSource(ctor: EventSourceCtor | undefined): void {
  esCtor = ctor;
}

const buffer = new TurnBuffer({
  send: (callId, turn) => getApi().addTurn(callId, turn),
  onChange: ({ pending }) => callStore.set((s) => ({ ...s, queued: pending })),
  onDrop: (_item, e) => callStore.set((s) => ({ ...s, error: e instanceof Error ? e.message : 'A turn could not be saved' })),
});

/** Follow a call over SSE. Detaches the previous one. */
export function attachCall(callId: string, initial?: CallView): void {
  if (callStore.get().callId === callId && unsubscribe) return;
  detachCall();
  callStore.set({ callId, view: initial ?? null, connection: 'live', queued: 0, error: null });
  try {
    unsubscribe = subscribeCall(
      getApi(),
      callId,
      {
        onView: (view) => callStore.set((s) => (s.callId === callId ? { ...s, view } : s)),
        onEvent: (e, v) => {
          if (e.type === 'playbook.updated') uiStore.set((u) => ({ ...u, highlightLines: [...e.lineIds, ...e.candidatesAdded] }));
          for (const fn of [...eventListeners]) fn(e, v);
        },
        onConnection: (connection) => callStore.set((s) => (s.callId === callId ? { ...s, connection } : s)),
        onError: () => {},
      },
      esCtor ? { EventSource: esCtor } : {},
    );
  } catch (e) {
    callStore.set((s) => ({ ...s, connection: 'offline', error: e instanceof Error ? e.message : String(e) }));
  }
}

export function detachCall(): void {
  unsubscribe?.();
  unsubscribe = null;
  callStore.set({ callId: null, view: null, connection: 'live', queued: 0, error: null });
}

/** Starts a call (with `contactId`, the server fills the prospect from the saved contact). */
export async function startCall(req: Parameters<CueApi['createCall']>[0]): Promise<CallView> {
  const view = await getApi().createCall(req);
  attachCall(view.id, view);
  return view;
}

/** Queue a turn for the attached call; the buffer replays it if the server is away. */
export function addTurn(turn: TurnInput): string | null {
  const { callId } = callStore.get();
  if (!callId) return null;
  return buffer.push(callId, turn);
}

export async function sendAction(suggestionId: string, action: SuggestionAction, text?: string): Promise<void> {
  const { callId } = callStore.get();
  if (!callId) return;
  try {
    await getApi().suggestionAction(callId, suggestionId, { action, ...(text ? { text } : {}) });
  } catch (e) {
    callStore.set((s) => ({ ...s, error: e instanceof Error ? e.message : 'Could not save that' }));
  }
}

export async function endCall(outcome?: Outcome): Promise<CallView | null> {
  const { callId } = callStore.get();
  if (!callId) return null;
  await buffer.flush();
  const view = await getApi().endCall(callId, outcome ? { outcome } : {});
  callStore.set((s) => (s.callId === callId && (!s.view || view.lastSeq >= s.view.lastSeq) ? { ...s, view } : s));
  return view;
}

/** Space-to-talk and the composer both need the latest call's start. */
export function callStartedAt(): number | null {
  return callStore.get().view?.startedAt ?? null;
}
