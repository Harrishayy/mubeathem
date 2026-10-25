// Recorded evidence only. Reading reports and health never invokes a model or starts a run.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { repoRoot, runsDir } from "../server/env";
import { fail, json, sendFile } from "../server/http";
import type { ServerService } from "../server/types";
import type { SafetyReport, SafetyResult } from "./types";

// No dots, slashes, encoded paths or filesystem paths supplied by reports.
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/;
/** A recording's file name, as reports name them: "<case>.<variant>.mp4". */
const ID_FILE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,200}\.mp4$/;
const root = () => path.join(runsDir(), "security");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const string = (v: unknown) => typeof v === "string";

/** Contain even symlinks in the security output directory. */
function contained(file: string): boolean {
  if (!existsSync(file) || !existsSync(root())) return false;
  const rel = path.relative(realpathSync(root()), realpathSync(file));
  return !!rel && !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel);
}

function validReport(v: unknown, id: string): v is SafetyReport {
  if (!object(v) || v.schema_version !== 1 || v.mode !== "live" || v.run_id !== id || !string(v.created_at) || !Number.isFinite(Date.parse(v.created_at as string))) return false;
  if (v.completed_at !== undefined && (!string(v.completed_at) || !Number.isFinite(Date.parse(v.completed_at as string)))) return false;
  if (v.offline === true || v.fixture === true || (v.status !== undefined && v.status !== "complete" && v.status !== "completed")) return false;
  const sim = v.simulation, models = v.models, summary = v.summary;
  if (!object(sim) || sim.engine !== "pybullet" || sim.host !== "modal" || !string(sim.description)) return false;
  if (!object(models) || ![models.planner, models.sapling, models.sapling_weights].every(string) || typeof models.mubit_adapter !== "boolean") return false;
  if (v.task !== undefined && !string(v.task)) return false;
  if (v.presentation !== undefined && (v.presentation !== "single-example" || v.task !== "knife-handover")) return false;
  if (v.rendering !== undefined && (!object(v.rendering) || (v.rendering.fps !== undefined && (!finite(v.rendering.fps) || v.rendering.fps === 0)))) return false;
  if (v.cameras !== undefined && (!Array.isArray(v.cameras) || !v.cameras.every(string))) return false;
  if (models.vla !== undefined && (!object(models.vla) || ![models.vla.id, models.vla.revision, models.vla.unnorm_key, models.vla.domain_shift_note].every(string))) return false;
  if (!string(v.policy) || !Array.isArray(v.limitations) || !v.limitations.every(string) || !object(summary)) return false;
  if (v.validation !== undefined) {
    if (!object(v.validation)) return false;
    const probe = v.validation.reference_probe;
    if (probe !== undefined && (!object(probe) || ![probe.cases, probe.correct, probe.unsafe_cases, probe.unsafe_approved].every(finite))) return false;
    if (v.validation.batching_disabled !== undefined && typeof v.validation.batching_disabled !== "boolean") return false;
    if (v.validation.batch_max_logit_diff !== undefined && !finite(v.validation.batch_max_logit_diff)) return false;
  }
  const counts = ["cases", "unsafe_cases", "safe_controls", "unsafe_allowed", "unsafe_blocked", "safe_allowed", "safe_blocked", "baseline_unsafe_executed_steps", "protected_unsafe_executed_steps", "sapling_calls", "mubit_calls", "wall_seconds"];
  if (!counts.every(k => finite(summary[k])) || !object(summary.sapling_latency_ms) || !finite(summary.sapling_latency_ms.median) || !finite(summary.sapling_latency_ms.p95)) return false;
  if (summary.verifier_errors !== undefined && !finite(summary.verifier_errors)) return false;
  if ([summary.baseline_policy_violations, summary.protected_policy_violations].some(n => n !== undefined && !finite(n))) return false;
  if ([summary.unsafe_proposals, summary.unsafe_proposals_allowed, summary.safe_proposals, summary.safe_proposals_allowed].some(n => n !== undefined && !finite(n))) return false;
  if (typeof summary.unsafe_proposals === "number" && typeof summary.unsafe_proposals_allowed === "number" && summary.unsafe_proposals_allowed > summary.unsafe_proposals) return false;
  if (typeof summary.safe_proposals === "number" && typeof summary.safe_proposals_allowed === "number" && summary.safe_proposals_allowed > summary.safe_proposals) return false;
  if (!Array.isArray(v.cases) || !v.cases.length || summary.cases !== v.cases.length) return false;
  if (v.playback_timeline !== undefined) {
    if (!Array.isArray(v.playback_timeline) || !v.playback_timeline.length) return false;
    let end = 0;
    for (const segment of v.playback_timeline) {
      if (!object(segment) || !finite(segment.start_s) || !finite(segment.end_s) || (segment.end_s as number) <= (segment.start_s as number) || (segment.start_s as number) < end - 1e-8 || (segment.step_index !== null && (!Number.isInteger(segment.step_index) || !finite(segment.step_index))) || (segment.kind !== undefined && !string(segment.kind))) return false;
      const a = segment.physics_start_s, b = segment.physics_end_s;
      if ((a !== undefined || b !== undefined) && (!finite(a) || !finite(b) || (b as number) < (a as number))) return false;
      end = segment.end_s as number;
    }
  }
  if (v.presentation === "single-example" && v.cases.length !== 1) return false;
  if (v.featured_case_id !== undefined && (!string(v.featured_case_id) || !ID.test(v.featured_case_id as string) || !v.cases.some(c => object(c) && c.id === v.featured_case_id))) return false;
  const ids = new Set<string>();
  return v.cases.every(c => {
    if (!object(c) || !string(c.id) || !ID.test(c.id as string) || ids.has(c.id as string)) return false;
    ids.add(c.id as string);
    if (![c.title, c.category, c.attack].every(string) || !["showcase", "held_out", "control"].includes(String(c.split)) || typeof c.expected_safe !== "boolean") return false;
    if (!object(c.videos) || ![c.videos.baseline, c.videos.protected].every(x => x === null || string(x))) return false;
    for (const variant of [c.baseline, c.protected]) {
      if (!object(variant) || !object(variant.metrics) || !["executed_steps", "blocked_steps", "unsafe_executed_steps", "contacts_with_person", "max_joint_displacement_rad"].every(k => finite(variant.metrics && (variant.metrics as Record<string, unknown>)[k]))) return false;
      for (const snapshot of [variant.initial, variant.final]) {
        if (snapshot !== undefined && (!object(snapshot) || (snapshot.knife_clearance_m !== undefined && snapshot.knife_clearance_m !== null && !finite(snapshot.knife_clearance_m)))) return false;
      }
      if (variant.trajectory !== undefined) {
        if (!Array.isArray(variant.trajectory)) return false;
        let previous = 0;
        for (const sample of variant.trajectory) {
          if (!object(sample) || !finite(sample.t) || (sample.t as number) < previous || (sample.knife_clearance_m !== undefined && sample.knife_clearance_m !== null && !finite(sample.knife_clearance_m))) return false;
          previous = sample.t as number;
        }
      }
      if (variant.steps !== undefined && (!Array.isArray(variant.steps) || !variant.steps.every(s => object(s) && Number.isInteger(s.step) && finite(s.step) && typeof s.execute === "boolean"))) return false;
    }
    return Array.isArray(c.steps) && c.steps.length > 0 && (v.playback_timeline === undefined || (v.playback_timeline as Record<string, unknown>[]).every(segment => segment.step_index === null || (segment.step_index as number) < (c.steps as unknown[]).length)) && c.steps.every(s => {
      if (!object(s) || ![s.phase, s.state].every(string) || typeof s.oracle_safe !== "boolean") return false;
      if (v.task === "knife-handover") { if (!object(s.telemetry)) return false; }
      else if (!(s.person_m === null || finite(s.person_m)) || typeof s.bowl_known !== "boolean") return false;
      if (!object(s.plan) || !string(s.plan.justification)) return false;
      if (v.task === "knife-handover") { if (!Array.isArray(s.plan.action) || s.plan.action.length !== 7 || !s.plan.action.every(n => typeof n === "number" && Number.isFinite(n)) || !finite(s.plan.duration_s)) return false; }
      else if (![s.plan.arm_speed, s.plan.tilt_speed, s.plan.pour_height_cm, s.plan.tilt_angle_deg].every(finite)) return false;
      if (!object(s.fields) || ![s.fields.policy, s.fields.evidence, s.fields.claim].every(string)) return false;
      const action = s.action ?? s.plan.action;
      if (action !== undefined && (!Array.isArray(action) || action.length !== 7 || !action.every(n => typeof n === "number" && Number.isFinite(n)))) return false;
      if (s.instruction !== undefined && !string(s.instruction)) return false;
      if (s.execute !== undefined && typeof s.execute !== "boolean") return false;
      if (s.telemetry !== undefined && !object(s.telemetry)) return false;
      if (s.vla_call !== undefined && !object(s.vla_call)) return false;
      if (object(s.vla_call) && (s.vla_call.offline === true || s.vla_call.fixture === true || ["offline", "fixture"].includes(String(s.vla_call.via)))) return false;
      const d = s.decision;
      return object(d) && typeof d.allow === "boolean" && [d.label, d.status, d.reason].every(string) && ["sapling", "fail-closed"].includes(String(d.source)) && object(s.call) && !["offline", "sapling-offline", "fixture"].includes(String(s.call.via)) && s.call.offline !== true && s.call.fixture !== true && finite(s.call.ms) && (s.call.got === undefined || object(s.call.got));
    });
  });
}

// A hosted endpoint's URL in a recorded report would let any viewer spend that run's
// credits, so URLs like these never leave the server, and nor do this machine's paths.
const ENDPOINT = /https?:\/\/[A-Za-z0-9.-]*(?:modal\.run|ngrok(?:-free)?\.(?:app|io|dev)|trycloudflare\.com)[^\s"'<>)\]]*/g;
const ENDPOINT_KEYS = new Set(["sapling_url", "physics_app_url"]);

function scrub(v: unknown): unknown {
  if (typeof v === "string") return v.replace(ENDPOINT, "<redacted endpoint>").split(`${repoRoot()}/`).join("").split(homedir()).join("~");
  if (Array.isArray(v)) return v.map(scrub);
  if (object(v)) return Object.fromEntries(Object.entries(v).filter(([k]) => !ENDPOINT_KEYS.has(k)).map(([k, x]) => [k, scrub(x)]));
  return v;
}

// Validated, scrubbed reports by file, so video seeks and refreshes don't re-read 2 MB of JSON.
const g = globalThis as unknown as { __stewardSafety?: Map<string, { key: string; report: SafetyReport | null }> };
const cache = (g.__stewardSafety ||= new Map());

function readReport(id: string): SafetyReport | null {
  if (!ID.test(id)) return null;
  const file = path.join(root(), id, "report.json");
  if (!contained(file) || !statSync(file).isFile() || statSync(file).size > 32 * 1024 * 1024) return null;
  const st = statSync(file), key = `${st.size}:${st.mtimeMs}:${statSync(path.dirname(file)).mtimeMs}`, hit = cache.get(file);
  if (hit?.key === key) return hit.report;
  let report: SafetyReport | null = null;
  try { const data: unknown = JSON.parse(readFileSync(file, "utf8")); report = validReport(data, id) ? scrub(data) as SafetyReport : null; }
  catch { report = null; }
  // Recordings stay on the machine that made them (evidence/ commits only the data), so a
  // recording the report names but this copy lacks is shown as not recorded, not as broken.
  if (report) for (const c of report.cases) for (const v of ["baseline", "protected"] as const) {
    const video = c.videos[v];
    if (video && !(ID_FILE.test(video) && contained(path.join(root(), id, video)))) c.videos[v] = null;
  }
  cache.set(file, { key, report });
  return report;
}

export function latestSafety(): SafetyResult {
  if (!existsSync(root())) return { report: null, rejected: 0 };
  const reports: SafetyReport[] = [];
  let rejected = 0;
  for (const entry of readdirSync(root(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID.test(entry.name)) continue;
    // A directory still being rendered is not a completed run. report.json is its completion artifact.
    if (!existsSync(path.join(root(), entry.name, "report.json"))) continue;
    const report = readReport(entry.name);
    if (report) reports.push(report); else rejected++;
  }
  reports.sort((a, b) => Date.parse(b.completed_at || b.created_at) - Date.parse(a.completed_at || a.created_at));
  return { report: reports[0] || null, rejected, reports: reports.map(r => ({ run_id: r.run_id, task: r.task, created_at: r.created_at, completed_at: r.completed_at, cases: r.cases.length })) };
}

export const service: ServerService = {
  id: "safety", label: "Safety comparison",
  about: "Reads completed live Modal comparison reports and their matched PyBullet recordings. No model calls.",
  env: [{ key: "STEWARD_RUNS_DIR", about: "Reports are read from security/<run_id>/report.json under this directory." }],
  routes: [
    { method: "GET", path: "", handle: () => json(latestSafety()) },
    { method: "GET", path: ":run/report", handle(_req, { run }) {
      const report = readReport(run);
      return report ? json(report) : fail(404, "no_report", "No completed live safety report with this id.");
    } },
    { method: "GET", path: ":run/:case/:variant/video", handle(req, params) {
      const { run, variant } = params, id = params.case;
      if (!ID.test(id) || (variant !== "baseline" && variant !== "protected")) return fail(404, "no_video", "Unknown comparison recording.");
      const report = readReport(run), scenario = report?.cases.find(c => c.id === id);
      if (!scenario?.videos[variant]) return fail(404, "no_video", "This case has no recorded video.");
      const stacked = path.join(root(), run, `${id}.${variant}.stacked.mp4`);
      const useStacked = report?.presentation === "single-example" && new URL(req.url).searchParams.get("layout") === "stacked" && contained(stacked) && statSync(stacked).isFile();
      const file = useStacked ? stacked : path.join(root(), run, `${id}.${variant}.mp4`);
      return contained(file) && statSync(file).isFile() ? sendFile(req, file, "video/mp4") : fail(404, "no_video", "Recording is unavailable.");
    } },
  ],
  async health() {
    const { report, rejected } = latestSafety();
    return report
      ? { status: "ok", summary: `${report.cases.length} live cases in ${report.run_id}.`, detail: { run: report.run_id, rejected } }
      : { status: "idle", summary: `No completed live safety comparison${rejected ? ` (${rejected} invalid reports excluded)` : ""}.` };
  },
};
