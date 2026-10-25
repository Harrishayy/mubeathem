import type { SafetyPlaybackSegment, SafetyReport, SafetyVariant } from "./types";

export interface ReplayFrame { stepIndex: number; progress: number; physicsTime: number | null; moving: boolean; pending: boolean }

/** Video time is mapped only through the renderer's recorded timeline. */
export function replayFrame(report: SafetyReport, seconds: number): ReplayFrame | null {
  const timeline = report.playback_timeline;
  if (!timeline?.length) return null;
  const actions = timeline.filter(entry => typeof entry.step_index === "number" && !entry.kind?.includes("hold"));
  if (!actions.length) return null;
  let segment: SafetyPlaybackSegment = timeline[0];
  for (const entry of timeline) {
    if (entry.start_s > seconds) break;
    segment = entry;
    if (seconds < entry.end_s) break;
  }
  const fraction = Math.max(0, Math.min(1, (seconds - segment.start_s) / (segment.end_s - segment.start_s)));
  const hold = segment.step_index === null || !!segment.kind?.includes("hold");
  const pending = seconds < actions[0].start_s;
  const action = !hold ? segment : [...actions].reverse().find(entry => entry.start_s <= seconds) || actions[0];
  const progress = hold ? pending ? 0 : 1 : fraction;
  const physicsTime = typeof segment.physics_start_s === "number" && typeof segment.physics_end_s === "number"
    ? segment.physics_start_s + fraction * (segment.physics_end_s - segment.physics_start_s) : null;
  return { stepIndex: action.step_index as number, progress, physicsTime, moving: !hold && seconds >= segment.start_s && seconds < segment.end_s, pending };
}

/** Linear interpolation between actual telemetry samples, without extrapolating unknown values. */
export function replayClearance(variant: SafetyVariant, physicsTime: number | null): number | null {
  if (physicsTime === null) return null;
  const initial = variant.initial?.knife_clearance_m;
  if (physicsTime <= 0) return typeof initial === "number" ? initial : null;
  const samples = variant.trajectory;
  if (!samples?.length) return null;
  let lo = 0, hi = samples.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (samples[mid].t < physicsTime) lo = mid + 1; else hi = mid; }
  if (lo === samples.length) {
    const end = variant.final?.knife_clearance_m === undefined ? samples.at(-1)?.knife_clearance_m : variant.final.knife_clearance_m;
    return typeof end === "number" ? end : null;
  }
  const right = samples[lo], left = lo > 0 ? samples[lo - 1] : { t: 0, knife_clearance_m: initial };
  const a = left.knife_clearance_m, b = right.knife_clearance_m;
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (right.t === left.t) return b;
  const fraction = Math.max(0, Math.min(1, (physicsTime - left.t) / (right.t - left.t)));
  return a + fraction * (b - a);
}
