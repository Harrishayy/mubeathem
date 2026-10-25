// Model calls inside an episode: which call produced which decision, who answered it,
// and a one-line summary of what came back. Steward logs each call just before the
// decision it produced (steward/EVENTS.md), so pairing them is by order.

import { planBrief } from "./text";
import { VERDICT } from "./text";
import type { Episode, SEvent } from "./types";

/** The call task behind each decision kind. */
export const CALL_TASK: Record<string, string> = { plan: "plan", safety: "verify", lesson: "lesson" };

/** Index of the call that produced decision i, or -1. */
export function callFor(ep: Episode, i: number): number {
  const task = CALL_TASK[ep.events[i]?.kind];
  if (!task) return -1;
  for (let j = i - 1; j >= 0; j--) {
    const e = ep.events[j];
    if (e.kind === "call") { if (e.task === task) return j; continue; }
    if (CALL_TASK[e.kind] === task) return -1;
  }
  return -1;
}

/** Index of the decision call ci produced, or -1 (a failed call produces none). */
export function decisionFor(ep: Episode, ci: number): number {
  const task = ep.events[ci]?.task;
  for (let j = ci + 1; j < ep.events.length; j++) {
    const e = ep.events[j];
    if (CALL_TASK[e.kind] === task) return j;
    if (e.kind === "call" && e.task === task) return -1;
  }
  return -1;
}

export const isSapling = (via?: string) => !!via && via.startsWith("sapling");

export function viaLabel(via?: string): string {
  switch (via) {
    case "mubit": return "Mubit";
    case "sapling": return "Sapling";
    case undefined: case "": return "Mubit";
    default: return via;
  }
}

/** Sapling's calibrated probability for the label it gave, if the call has one. */
export function topProbability(e: SEvent): number | null {
  const p = e.got?.probabilities, label = e.got?.raw_label || e.got?.status;
  return p && label && typeof p[label] === "number" ? p[label] : null;
}

/** What came back, in a few words. */
export function callResult(e: SEvent): string {
  if (e.error) return `failed: ${e.error}`;
  const g = e.got;
  if (!g) return e.request_id ? String(e.request_id) : "no payload logged";
  if (e.task === "plan") return planBrief(g) || "plan";
  if (e.task === "verify") {
    const label = g.label || g.raw_label || g.status, p = topProbability(e);
    const unsure = g.status === "unsure";
    return `${unsure ? "unsure · " : ""}${VERDICT[label] || label}${p != null ? ` ${Math.round(p * 100)}%` : ""}`;
  }
  if (e.task === "lesson") return String(g.text || "");
  return JSON.stringify(g).slice(0, 80);
}
