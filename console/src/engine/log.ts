// Log rows back to the JSON lines Steward writes, for copying and the event detail.

import { EPOCH, TAKE } from "./format";
import type { LogEntry } from "./types";

/** One row as the JSON line Steward wrote (real runs keep their own t and take). */
export function toLine(l: LogEntry): Record<string, unknown> {
  if (l.raw) { const { vt, ...line } = l.raw; void vt; return line; }
  const { at, vt, ...rest } = l.data;
  void at; void vt;
  return { t: typeof rest.t === "number" ? rest.t : Math.round((EPOCH + l.abs) * 1000) / 1000, take: rest.take || TAKE, ...rest, kind: l.kind, robot: rest.robot || l.robot };
}
/** The same JSON lines Steward writes to runs/takes/<take>.jsonl. */
export const toJsonl = (rows: LogEntry[]) => rows.map((l) => JSON.stringify(toLine(l))).join("\n");
