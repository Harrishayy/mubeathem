// Reading an episode at time t: which segment, which phase, how far along, what status.

import { viaLabel } from "./calls";
import type { Episode, Robot, Status } from "./types";

export const DECISION_KINDS = new Set(["plan", "safety", "hold", "escalate", "result", "lesson"]);

export function stateAt(ep: Episode, t: number) {
  if (t >= ep.duration - 0.6) return { kind: "done" as const };
  for (const s of ep.segs) if (t >= s.t0 && t < s.t1) return { kind: s.kind, seg: s, phase: s.phase };
  return { kind: "gap" as const };
}

export function poseAt(ep: Episode, t: number) {
  let phase = -1, u = 0;
  for (const s of ep.segs) {
    if (s.kind !== "motion") continue;
    if (t >= s.t1) { phase = s.phase!; u = 1; }
    else if (t >= s.t0) { phase = s.phase!; u = (t - s.t0) / (s.t1 - s.t0); break; }
  }
  return { phase, u };
}

export function currentPhase(ep: Episode, t: number): string | null {
  let ph: string | null = null;
  for (const e of ep.events) { if (e.at > t) break; if (e.kind === "phase") ph = e.phase; }
  return ph;
}

/** What the robot is doing at t, in a few words. */
export function doing(ep: Episode, t: number) {
  const sa = stateAt(ep, t), ph = currentPhase(ep, t), { u } = poseAt(ep, t);
  if (sa.kind === "decide") return `${sa.seg.task} via ${viaLabel(sa.seg.via)}`;
  if (sa.kind === "hold") return "holding · not safe yet";
  if (sa.kind === "done") return ep.outcome === "success" ? "done" : ep.outcome;
  return ph ? `${ph}${sa.kind === "motion" ? ` ${Math.round(u * 100)}%` : ""}` : "planning";
}

/** From the log: a finished attempt has an outcome; a live one is acting or between model calls. */
export function liveStatus(r: Robot): Status {
  if (r.imported) return "imported";
  const ep = r.ep, last = ep.events[ep.events.length - 1];
  if (!r.live || ep.outcome) return (ep.outcome || "stopped") as Status;
  if (last?.kind === "hold") return "holding";
  if (ep.world === "isaac" && last?.kind === "safety" && last.label === "supported") return "running";
  return "deciding";
}

export const successRate = (eps: Episode[]) => (eps.length ? eps.filter((e) => e.outcome === "success").length / eps.length : 0);

/** Index of the last event at or before t, and of the last one that isn't a model call. */
export function eventIndexAt(ep: Episode, t: number) {
  let idx = -1;
  for (let i = 0; i < ep.events.length; i++) { if (ep.events[i].at <= t + 1e-6) idx = i; else break; }
  for (let i = idx; i >= 0; i--) if (ep.events[i].kind !== "call") return { idx, now: i };
  return { idx, now: -1 };
}
