// What Steward's task is, read from the takes themselves. Each take's `take` event carries
// the manifest (steward/tasks.py manifest()): phases, plan ranges, safety policy and the
// fixed instructions of each model task. Takes logged before the manifest existed fall
// back to what their events show: the phases they logged and the ranges their plans used.

import type { Episode, Manifest, Range, TaskSpec } from "./types";

export const EMPTY_SPEC: TaskSpec = { phases: [], params: {}, policy: [], tasks: {} };

const firstLine = (s: string) => s.split("\n")[0].trim().replace(/\.$/, "");

/** The newest manifest wins; episodes fill in anything no manifest covers. */
export function specOf(manifests: Manifest[], eps: Episode[]): TaskSpec {
  const m = manifests[manifests.length - 1];
  const phases = m?.phases?.length ? [...m.phases] : [];
  if (!phases.length) for (const ep of eps) for (const e of ep.events) if (e.kind === "phase" && !phases.includes(e.phase)) phases.push(e.phase);
  const params: Record<string, Range> = {};
  if (m?.ranges) for (const [k, r] of Object.entries(m.ranges)) params[k] = [r[0], r[1]];
  else for (const ep of eps) for (const [k, v] of Object.entries(ep.plan)) {
    const r = params[k];
    params[k] = r ? [Math.min(r[0], v), Math.max(r[1], v)] : [v, v];
  }
  const tasks: TaskSpec["tasks"] = {};
  for (const [k, t] of Object.entries(m?.tasks || {})) tasks[k] = { label: firstLine(t.instructions || k) };
  return { phases, params, policy: (m?.policy || "").split("\n").map((l) => l.trim()).filter(Boolean), tasks };
}

/** "pour" → "Pour". Steward names its task in the episodes it builds (sources/runs/build.ts). */
export const taskName = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
