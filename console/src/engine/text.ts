// Plain-text wording for events, shared by the log, the trace and the assistant.

import { fmtP, SHORT } from "./format";
import type { SEvent, Settings } from "./types";

export const VERDICT: Record<string, string> = { supported: "Supported", violation: "Violation", insufficient_information: "Insufficient info", inconsistent_context: "Inconsistent" };
export const STATUS_LABEL: Record<string, string> = { running: "Running", deciding: "Deciding", holding: "Holding", success: "Succeeded", failed: "Failed", stopped: "Stopped", imported: "Imported" };

/** The plan's numeric settings, in the order the planner returned them. */
export function planBrief(plan: Settings) {
  return Object.keys(plan).filter((k) => typeof plan[k] === "number").map((k) => `${SHORT[k] || k} ${fmtP(k, plan[k])}`).join(" · ");
}

/** One line describing an event. For safety verdicts, the verdict label is separate (see EventText). */
export function eventText(e: SEvent): string {
  switch (e.kind) {
    case "attempt": return `Attempt ${e.attempt}: ${e.subject}`;
    case "lessons": return e.lessons?.length ? `Recalled ${e.lessons.map((l: { id: string }) => l.id).join(", ")}` : "No matching lessons";
    case "call": return `${e.task} · ${e.ms} ms · ${e.request_id || ""}`;
    case "plan": return planBrief(e.plan || {});
    case "phase": return `Phase: ${e.phase}`;
    case "safety": return String(e.reason || "");
    case "hold": case "escalate": return String(e.reason || "");
    case "result": return `${e.success ? "Succeeded." : "Failed."} ${e.reason || ""}`;
    case "lesson": return `${e.revised ? "Revised" : "Wrote"} ${e.lesson?.id}: ${e.lesson?.text}`;
    case "outcome": return String(e.outcome);
    case "error": return `${e.where}: ${e.error}`;
    default: return JSON.stringify(e).slice(0, 160);
  }
}

export function eventPlain(e: SEvent) {
  return e.kind === "safety" ? `${VERDICT[e.label] || e.label}${e.status === "unsure" ? " (unsure)" : ""}: ${e.reason}` : eventText(e);
}
