// Log rows back to the JSON lines Steward writes, for copying and the event detail.

import type { LogEntry } from "./types";

/** One row exactly as Steward wrote it, without the console's video time. */
export function toLine(l: LogEntry): Record<string, unknown> {
  const { vt, ...line } = l.raw; void vt;
  return line;
}
/** The same JSON lines Steward writes to runs/takes/<take>.jsonl. */
export const toJsonl = (rows: LogEntry[]) => rows.map((l) => JSON.stringify(toLine(l))).join("\n");
