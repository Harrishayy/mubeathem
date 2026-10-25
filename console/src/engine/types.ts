// The data the console works with. Event and episode shapes match what Steward
// writes to runs/takes/<take>.jsonl (the contract: steward/EVENTS.md). A source
// (src/sources/) fills this state from Steward's real runs.

import type { TakeSummary } from "@/services/types";

/** The task Steward runs, as build.ts names it ("pour"). */
export type TaskKey = string;
export type Outcome = "success" | "failed" | "stopped" | "";
export type Status = "running" | "deciding" | "holding" | "success" | "failed" | "stopped" | "imported";
export type Settings = Record<string, number>;
export type Range = [number, number];

/** What an attempt was asked to do: Steward's subject line, and the words a lesson can match on. */
export interface Variant { subject: string; applies: string[] }

/** The task as the takes' manifests describe it (engine/task.ts). */
export interface TaskSpec {
  phases: string[];
  params: Record<string, Range>;
  policy: string[];
  /** Each model task (plan, verify, lesson): the first line of its fixed instructions. */
  tasks: Record<string, { label: string }>;
}

export interface Seg { kind: "decide" | "hold" | "motion"; t0: number; t1: number; phase?: number; task?: string; via?: string }

/** One Steward event. `at` is seconds from the start of its episode. */
export interface SEvent { at: number; kind: string; robot: string; t?: number; [key: string]: any }

export interface LessonRef { id: string; text: string; source: string; settings: Settings }

/** Where an episode ran: an Isaac take (with video when it was recorded), or the text-only practice world. */
export type World = "isaac" | "text";
export interface EpisodeVideo { take: string; src: string; povSrc: string | null; prepared: boolean; start: number; end: number; fps: number }

export interface Episode {
  id: string; n: number; robot: string; task: TaskKey; variant: Variant; start: number;
  /** The take it came from, its attempt number there, and where it ran. */
  take: string; attempt: number; world: World; video: EpisodeVideo | null;
  /** The scene as Steward described it to the planner. */
  scene: string;
  lessons: LessonRef[]; plan: Settings; justification: string;
  success: boolean; events: SEvent[]; segs: Seg[];
  reason: string; outcome: Outcome; lessonWritten: string | null;
  holds: number; duration: number; resultAt?: number; imported?: boolean;
}

export interface Robot {
  id: string; name: string; task: TaskKey; model: string; env: string;
  history: Episode[]; count: number;
  lastEv: SEvent | null; ep: Episode; imported?: boolean;
  /** True while its take is still writing. */
  live?: boolean;
}

export interface Lesson {
  id: string; task: TaskKey; text: string; applies_to: string[]; settings: Settings; source_robot: string;
  uses: number; successes: number; created_abs: number | null; retired?: boolean;
  /** The lesson file it lives in (relative to the runs dir), and a key unique across files. */
  file: string; key: string; scope?: string;
}

export interface LogEntry { seq: number; abs: number; robot: string; kind: string; data: SEvent; epId: string | null; at?: number; /** The line exactly as Steward logged it. */ raw: Record<string, unknown> }

export interface MubitCall { abs: number; robot: string; task: string; ms: number; request_id: string; error?: string }
/** One Mubit task's calls, from the logs. Mubit decides server-side which calls it keeps and trains on. */
export interface MubitTask { calls: number; errors: number; lat: number[]; recent: MubitCall[] }

export interface Fix { param: string; value: number; applies_to: string[]; lesson: string; status: "open" | "added" | "queued" | "dismissed"; lessonId?: string }
export type ChatItem =
  | { role: "read" | "user" | "assistant"; text: string; pending?: boolean; failed?: boolean; note?: string; via?: string }
  | { role: "fix"; fix: Fix };

export interface Manifest {
  phases?: string[]; policy?: string; ranges?: Record<string, [number, number]>;
  sapling?: { policy: string; phase_steps: Record<string, string> };
  tasks?: Record<string, { instructions: string; schema: unknown }>;
}

/** A capability a source offers. Panels list what they need in meta.needs. */
export type Cap = "rerun" | "payloads" | "video" | "takes" | "lessons-write" | "practice";
export interface SourceInfo { id: string; label: string; caps: Cap[]; live: boolean; connected: boolean; note?: string }

/** One model call: the episode it belongs to and its index in ep.events. */
export interface CallRef { epId: string; idx: number; abs: number; robot: string; task: string; via: string; ms: number; error?: string }

export interface State {
  source: SourceInfo;
  /** Now, in console seconds (engine/format.ts EPOCH). */
  simNow: number;
  robots: Robot[]; byId: Record<string, Robot>; episodes: Record<string, Episode>; done: Episode[];
  lessons: Lesson[];
  log: LogEntry[]; logSeq: number; logSel: number | null;
  calls: CallRef[]; callSel: CallRef | null;
  takes: TakeSummary[];
  /** Each take's `steward` manifest (fixed instructions, schemas, policy), by take id. */
  manifests: Record<string, Manifest>;
  /** The task, from the newest manifest (engine/task.ts). */
  spec: TaskSpec;
  mubit: Record<string, MubitTask>;
  selection: { robotId: string | null; epId: string | null; live: boolean };
  playback: { t: number; playing: boolean; rate: number; pauseAt: boolean; holdUntil: number };
  chats: Record<string, { items: ChatItem[] }>;
}
