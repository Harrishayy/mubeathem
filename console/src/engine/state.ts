// The shape of the shared state, and small lookups every panel uses.

import { EMPTY_SPEC } from "./task";
import { EPOCH } from "./format";
import type { Episode, LogEntry, SourceInfo, State } from "./types";

export function initialState(source: SourceInfo): State {
  return {
    source,
    simNow: Date.now() / 1000 - EPOCH,
    robots: [], byId: {}, episodes: {}, done: [],
    lessons: [],
    log: [], logSeq: 0, logSel: null,
    calls: [], callSel: null, takes: [], manifests: {},
    spec: EMPTY_SPEC, mubit: {},
    selection: { robotId: null, epId: null, live: false },
    playback: { t: 0, playing: false, rate: 0.5, pauseAt: true, holdUntil: 0 },
    chats: {},
  };
}

const NAMES: Record<string, string> = { operator: "Operator", steward: "Steward" };
export const nameOf = (st: State, id: string) => st.byId[id]?.name || NAMES[id] || id;

export function selectedEpisode(st: State): Episode | null {
  const s = st.selection, r = s.robotId ? st.byId[s.robotId] : null;
  if (!r) return null;
  return s.live ? r.ep : (s.epId && st.episodes[s.epId]) || null;
}

export function pushLog(st: State, entry: Omit<LogEntry, "seq">, emit: (evt: string, p?: unknown) => void) {
  const e = { ...entry, seq: ++st.logSeq } as LogEntry;
  st.log.push(e);
  if (st.log.length > 2400) st.log.splice(0, st.log.length - 2400);
  emit("log", e);
  return e;
}
