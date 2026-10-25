// One shared state object plus named events. React components subscribe through the
// hooks in console/hooks.ts; the engine and actions emit.
//
// Events (payload):
//   frame (dt)                   every animation frame
//   select (selection)           the replayed robot or episode changed
//   playback (playback)          play, pause, rate or follow-live changed
//   seek (t)                     the playhead jumped
//   event ({ep, e})              the simulation fired one Steward event
//   episode:done ({ep, robot})   an episode finished
//   lessons ()                   fleet lessons changed
//   mubit ()                     Mubit call counts or adapter state changed
//   adapter ({task})             an adapter started serving
//   log (entry)                  a line was added to the event log
//   logsel (seq | null)          a log row was selected
//   robots ()                    the robot list changed (a take was imported)
//   fleet ()                     fleet speed, run/pause or a queued re-run changed
//   chat (episodeId)             a debrief conversation changed
//   navigate (tabId)             something asked to switch tabs
//   toast ({msg, label?, run?})  show a short message
//   theme ()                     light/dark changed
//   callsel (CallRef | null)     a model call was selected for the call inspector
//   source ()                    the source's status changed (connected, live, note)

import type { State } from "./types";

type Handler = (payload: any, state: State) => void;
const MAX_ERRORS = 3;

export interface Store {
  state: State;
  on(evt: string, fn: Handler): () => void;
  emit(evt: string, payload?: unknown): void;
}

export function createStore(state: State): Store {
  const subs = new Map<string, Set<{ fn: Handler; errors: number }>>();
  return {
    state,
    on(evt, fn) {
      if (!subs.has(evt)) subs.set(evt, new Set());
      const entry = { fn, errors: 0 };
      subs.get(evt)!.add(entry);
      return () => { subs.get(evt)?.delete(entry); };
    },
    emit(evt, payload) {
      const set = subs.get(evt);
      if (!set) return;
      for (const entry of [...set]) {
        try { entry.fn(payload, state); }
        catch (err) {
          // A broken handler is dropped after a few failures so it can't take the console down.
          entry.errors++;
          console.error(`[steward] "${evt}" handler failed`, err);
          if (entry.errors >= MAX_ERRORS) { set.delete(entry); console.warn(`[steward] dropped a failing "${evt}" handler`); }
        }
      }
    },
  };
}
