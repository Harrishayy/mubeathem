// The data the console works with. Event and episode shapes match what Steward
// writes to runs/takes/<take>.jsonl (the contract: steward/EVENTS.md). A source
// (src/sources/) fills this state: the demo fleet, or Steward's real runs.

import type { TakeSummary } from "@/services/types";

export type TaskKey = "pour" | "pick" | "stack";
export type Outcome = "success" | "failed" | "stopped" | "";
export type Status = "running" | "deciding" | "holding" | "success" | "failed" | "stopped" | "imported" | "queued";
export type Settings = Record<string, number>;
export type Range = [number, number];

export interface Variant {
  subject: string;
  applies: string[];
  phrase: string;
  contents?: string;
  bowl?: "wide" | "narrow";
  obj?: string;
  top?: { w: number; h: number };
  base?: { w: number; h: number; kind: "cup" | "saucer" };
  ideal: Record<string, Range>;
}

export interface Task {
  name: string;
  phases: string[];
  params: Record<string, Range>;
  prior: Settings;
  limit: { k: string; max: number; over: number };
  metric: { name: string; unit: string; limit: number };
  policy: string[];
  escalate: { label: string; reason: string };
  variants: Variant[];
}

export interface Candidate { plan: Settings; score: number; violation: string | null }
export interface Seg { kind: "decide" | "hold" | "motion"; t0: number; t1: number; phase?: number; task?: string; via?: string }

/** One Steward event. `at` is seconds from the start of its episode. */
export interface SEvent { at: number; kind: string; robot: string; t?: number; [key: string]: any }

export interface LessonRef { id: string; text: string; source: string; settings: Settings }

/** Where an episode's pictures come from: the browser simulation, an Isaac take, or the text-only practice world. */
export type World = "sim" | "isaac" | "text";
export interface EpisodeVideo { take: string; src: string; povSrc: string | null; prepared: boolean; start: number; end: number; fps: number }

export interface Episode {
  id: string; n: number; robot: string; task: TaskKey; variant: Variant; start: number;
  /** Set by real runs: the take it came from, its attempt number there, and its world. */
  take?: string; attempt?: number; world?: World; video?: EpisodeVideo | null;
  /** The scene as Steward described it to the planner (real runs). */
  scene?: string;
  lessons: LessonRef[]; cands: Candidate[]; chosen: number; plan: Settings; justification: string;
  success: boolean; p: number; worst: { k: string; dir: "hi" | "lo" } | null; override: Settings | null;
  events: SEvent[]; segs: Seg[]; person: { enter: number; leave: number; dist: number } | null;
  failAt: number | null; metric: number; reason: string; outcome: Outcome; lessonWritten: string | null;
  holds: number; duration: number; resultAt?: number; imported?: boolean;
  _pw?: { ts: number; te: number } | null;
}

export interface Robot {
  id: string; name: string; task: TaskKey; model: string; env: string;
  history: Episode[]; count: number; cur: number;
  queued: { variant: Variant; override: Settings } | null;
  lastEv: SEvent | null; ep: Episode; imported?: boolean;
  /** "run": from Steward's logs. `live` while its take is still writing. */
  kind?: "sim" | "run"; live?: boolean;
}

export interface Lesson {
  id: string; task: TaskKey; text: string; applies_to: string[]; settings: Settings; source_robot: string;
  uses: number; successes: number; created_abs: number | null; revisions: number;
  revised_abs?: number; retired?: boolean; revised?: boolean; revised_by?: string;
  /** Real runs: the lesson file it lives in (relative to the runs dir), and a key unique across files. */
  file?: string; key?: string; scope?: string;
}

export interface LogEntry { seq: number; abs: number; robot: string; kind: string; data: SEvent; epId: string | null; at?: number; /** Real runs: the line exactly as Steward logged it. */ raw?: Record<string, unknown> }

export interface MubitCall { abs: number; robot: string; task: string; ms: number; request_id: string; kept: boolean | null }
export interface MubitTask {
  /** kept is null when it isn't known (real runs: Mubit decides which calls it keeps). */
  calls: number; kept: number | null; state: "collecting" | "training" | "serving";
  trainStart: number | null; servingSince: number | null;
  lat: { ms: number; serving: boolean }[]; recent: MubitCall[];
}

export interface Fix { param: string; value: number; applies_to: string[]; lesson: string; status: "open" | "added" | "queued" | "dismissed"; lessonId?: string }
export type ChatItem =
  | { role: "read" | "user" | "assistant"; text: string; pending?: boolean; offline?: boolean; note?: string; via?: string }
  | { role: "fix"; fix: Fix };

export interface Manifest {
  phases?: string[]; policy?: string; claim?: string; ranges?: Record<string, [number, number]>;
  tasks?: Record<string, { instructions: string; schema: unknown }>;
}

/** A capability a source offers. Panels list what they need in meta.needs. */
export type Cap = "sim" | "samples" | "adapters" | "rerun" | "payloads" | "video" | "takes" | "lessons-write" | "practice";
export interface SourceInfo { id: string; label: string; caps: Cap[]; live: boolean; connected: boolean; note?: string }

/** One model call: the episode it belongs to and its index in ep.events. */
export interface CallRef { epId: string; idx: number; abs: number; robot: string; task: string; via: string; ms: number; error?: string }

export interface State {
  source: SourceInfo;
  simNow: number; speed: number; running: boolean;
  robots: Robot[]; byId: Record<string, Robot>; episodes: Record<string, Episode>; done: Episode[];
  lessons: Lesson[]; lessonSeq: number;
  log: LogEntry[]; logSeq: number; logSel: number | null;
  calls: CallRef[]; callSel: CallRef | null;
  takes: TakeSummary[];
  /** Each take's `steward` manifest (fixed instructions, schemas, policy), by take id. */
  manifests: Record<string, Manifest>;
  adapterMarks: { task: string; abs: number; doneIdx: number }[];
  mubit: Record<string, MubitTask>;
  selection: { robotId: string | null; epId: string | null; live: boolean };
  playback: { t: number; playing: boolean; rate: number; pauseAt: boolean; holdUntil: number };
  chats: Record<string, { items: ChatItem[] }>;
}
