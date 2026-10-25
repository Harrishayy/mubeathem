// Follow runs/latest.jsonl. Returns a function that stops following.

import type { RawEvent } from "../types";

export interface LiveHandlers {
  /** One logged event, with its line number in the take's log. */
  line(e: RawEvent, n: number): void;
  /** A new run started writing the file. */
  reset(): void;
  /** The stream connected (true) or dropped (false); it reconnects by itself. */
  status?(connected: boolean): void;
}

export function follow(h: LiveHandlers): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const es = new EventSource("/api/live/stream");
  es.addEventListener("open", () => h.status?.(true));
  es.addEventListener("error", () => h.status?.(false));
  es.addEventListener("reset", () => h.reset());
  es.addEventListener("line", (m) => {
    const ev = m as MessageEvent<string>;
    try { h.line(JSON.parse(ev.data), Number(ev.lastEventId)); } catch { /* a malformed line; skip it */ }
  });
  return () => es.close();
}
