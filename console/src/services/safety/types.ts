export interface SafetyMetrics {
  executed_steps: number;
  blocked_steps: number;
  unsafe_executed_steps: number;
  contacts_with_person: number;
  max_joint_displacement_rad: number;
  [key: string]: unknown;
}

export interface SafetyStep {
  phase: string;
  person_m?: number | null;
  bowl_known?: boolean;
  plan: { arm_speed?: number; pour_height_cm?: number; tilt_speed?: number; tilt_angle_deg?: number; action?: number[]; duration_s?: number; justification: string; [key: string]: unknown };
  state: string;
  fields: { policy: string; evidence: string; claim: string };
  oracle_safe: boolean;
  decision: { allow: boolean; label: string; status: string; reason: string; source: "sapling" | "fail-closed" };
  call: { ms: number; got?: Record<string, unknown>; error?: string; [key: string]: unknown };
  action?: number[];
  instruction?: string;
  telemetry?: Record<string, unknown>;
  vla_call?: Record<string, unknown>;
  execute?: boolean;
  [key: string]: unknown;
}

export interface SafetyCase {
  id: string; title: string; category: string; split: "showcase" | "held_out" | "control";
  attack: string; expected_safe: boolean; steps: SafetyStep[];
  baseline: SafetyVariant; protected: SafetyVariant;
  videos: { baseline: string | null; protected: string | null };
}

export interface SafetyVariant {
  metrics: SafetyMetrics;
  initial?: { knife_clearance_m?: number | null; [key: string]: unknown };
  final?: { knife_clearance_m?: number | null; [key: string]: unknown };
  trajectory?: { t: number; knife_clearance_m?: number | null; step?: number; execute?: boolean; [key: string]: unknown }[];
  steps?: { step: number; execute: boolean; [key: string]: unknown }[];
}

export interface SafetyPlaybackSegment {
  start_s: number; end_s: number; step_index: number | null; kind?: string;
  physics_start_s?: number; physics_end_s?: number;
}

export interface SafetyReport {
  schema_version: 1; run_id: string; created_at: string; completed_at?: string; mode: "live";
  task?: string;
  featured_case_id?: string;
  presentation?: "single-example";
  playback_timeline?: SafetyPlaybackSegment[];
  rendering?: { fps?: number; [key: string]: unknown };
  cameras?: string[];
  simulation: { engine: "pybullet"; host: "modal"; description: string };
  models: { planner: string; sapling: string; sapling_weights: string; mubit_adapter: boolean; vla?: { id: string; revision: string; unnorm_key: string; domain_shift_note: string } };
  limitations: string[]; policy: string;
  /** Each plan setting's allowed [low, high], from steward/tasks.py's manifest (pour reports). */
  ranges?: Record<string, [number, number]>;
  validation?: {
    reference_probe?: { cases: number; correct: number; unsafe_cases: number; unsafe_approved: number };
    batching_disabled?: boolean;
    batch_max_logit_diff?: number;
  };
  summary: {
    cases: number; unsafe_cases: number; safe_controls: number; unsafe_allowed: number; unsafe_blocked: number;
    safe_allowed: number; safe_blocked: number; baseline_unsafe_executed_steps: number;
    protected_unsafe_executed_steps: number; sapling_calls: number; mubit_calls: number;
    verifier_errors?: number;
    baseline_policy_violations?: number;
    protected_policy_violations?: number;
    unsafe_proposals?: number;
    unsafe_proposals_allowed?: number;
    safe_proposals?: number;
    safe_proposals_allowed?: number;
    sapling_latency_ms: { median: number; p95: number }; wall_seconds: number;
  };
  cases: SafetyCase[];
}

export interface SafetyReportSummary { run_id: string; created_at: string; completed_at?: string; task?: string; cases: number }
export interface SafetyResult { report: SafetyReport | null; rejected: number; reports?: SafetyReportSummary[] }
