// Shapes the services send over /api/*, shared by their server and client halves.
// The raw event fields are Steward's log contract: steward/EVENTS.md.

/** One line of runs/takes/<take>.jsonl, plus `vt` (seconds into the take's video) when it has one. */
export interface RawEvent { t: number; take: string; kind: string; robot?: string; vt?: number; [key: string]: any }

export type HealthStatus = "ok" | "idle" | "off" | "error";
export interface Health { status: HealthStatus; summary: string; detail?: Record<string, unknown> }

export interface EnvVar { key: string; about: string; secret?: boolean }
export interface ServiceStatus { id: string; label: string; about: string; env: (EnvVar & { set: boolean })[]; health: Health }
export interface HealthReport { services: ServiceStatus[]; root: string; disabled: string[] }

export interface TakeVideo {
  /** The player copy in runs/web (head-camera inset burned in), else the raw recording. */
  prepared: boolean;
  pov: boolean;
  fps: number;
  /** Seconds of video. */
  duration: number;
}

export interface TakeSummary {
  id: string;
  mode: string;                 // "isaac" | "practice" | whatever the take event says
  offline: boolean;
  fixture: boolean;
  verifier: string | null;      // "sapling" | "stand-in"
  model: string | null;
  started: number;              // unix seconds of the first event
  ended: number;
  events: number;
  robots: string[];
  attempts: number;
  outcomes: Record<string, number>;
  story: string;                // "spills → lands", from the results in order
  lessonsFile: string | null;   // relative to the runs dir
  video: TakeVideo | null;
  live: boolean;                // runs/latest.jsonl is this take and was written to recently
  bytes: number;
}

export interface TakeDetail { summary: TakeSummary; events: RawEvent[] }
export interface RunsList { dir: string; exists: boolean; takes: TakeSummary[] }

export interface StoredLesson {
  id: string; text: string; applies_to: string[]; source_robot: string;
  uses: number; successes: number; created_at?: string; retired?: boolean;
}
export interface LessonFile { file: string; scope: string; shared: boolean; lessons: StoredLesson[]; mtime: number }

export interface PracticeArgs { episodes: number; workers: number; seed?: number | null }
export interface PracticeStatus {
  running: boolean; pid: number | null; args: PracticeArgs | null;
  startedAt: number | null; endedAt: number | null; exitCode: number | null;
  output: string[]; python: string; canRunLive: boolean;
}

export interface SaplingCheck { policy: string; evidence: string; claim: string }
