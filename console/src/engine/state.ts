// The shape of the shared state, and small lookups every panel uses.

import { HIST, MUBIT_CFG } from "./world";
import type { Episode, LogEntry, MubitTask, SourceInfo, State } from "./types";

export function initialState(source: SourceInfo): State {
  const mubit: Record<string, MubitTask> = {};
  for (const k of Object.keys(MUBIT_CFG)) mubit[k] = { calls: 0, kept: 0, state: "collecting", trainStart: null, servingSince: null, lat: [], recent: [] };
  return {
    source,
    simNow: -HIST, speed: 1, running: true,
    robots: [], byId: {}, episodes: {}, done: [],
    lessons: [], lessonSeq: 0,
    log: [], logSeq: 0, logSel: null,
    calls: [], callSel: null, takes: [], manifests: {},
    adapterMarks: [], mubit,
    selection: { robotId: null, epId: null, live: false },
    playback: { t: 0, playing: false, rate: 0.5, pauseAt: true, holdUntil: 0 },
    chats: {},
  };
}

const NAMES: Record<string, string> = { operator: "Operator", mubit: "Mubit", fleet: "Fleet" };
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
