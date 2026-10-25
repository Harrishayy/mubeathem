// Live: follows runs/latest.jsonl, which every running take writes alongside its own log,
// and streams each new line to the browser as a server-sent event.
//
//   GET /api/live/stream   text/event-stream
//     event: line   id: <line number in the file>   data: <the JSON line>
//     event: reset  the file was started over (a new run began)
//
// Lines come from the top of the file, numbered; runs/takes/<take>.jsonl holds the same
// lines in the same order, so a client that already loaded N lines of a take skips ids < N.

import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { runsDir } from "../server/env";
import type { ServerService } from "../server/types";
import { liveTake } from "../runs/server";

const POLL_MS = 400;
const HEARTBEAT_MS = 15000;

function stream(req: Request): Response {
  const file = path.join(runsDir(), "latest.jsonl");
  const enc = new TextEncoder();
  let offset = 0, line = 0, rest = "", ino = -1, timer: ReturnType<typeof setInterval> | null = null, beat = 0;

  const body = new ReadableStream<Uint8Array>({
    start(ctl) {
      const send = (s: string) => { try { ctl.enqueue(enc.encode(s)); } catch { stop(); } };
      const stop = () => { if (timer) clearInterval(timer); timer = null; try { ctl.close(); } catch { /* closed */ } };
      req.signal.addEventListener("abort", stop);
      send("retry: 2000\n\n");
      const poll = () => {
        if (!existsSync(file)) return;
        const st = statSync(file);
        if (st.ino !== ino || st.size < offset) {
          if (ino !== -1) send("event: reset\ndata: {}\n\n");
          ino = st.ino; offset = 0; line = 0; rest = "";
        }
        if (st.size > offset) {
          const fd = openSync(file, "r");
          try {
            const buf = Buffer.alloc(Math.min(st.size - offset, 4 * 1024 * 1024));
            const n = readSync(fd, buf, 0, buf.length, offset);
            offset += n;
            const parts = (rest + buf.subarray(0, n).toString("utf8")).split("\n");
            rest = parts.pop() ?? "";
            for (const p of parts) if (p.trim()) send(`event: line\nid: ${line++}\ndata: ${p}\n\n`);
          } finally { closeSync(fd); }
        }
        if ((beat += POLL_MS) >= HEARTBEAT_MS) { beat = 0; send(": alive\n\n"); }
      };
      poll();
      timer = setInterval(poll, POLL_MS);
    },
    cancel() { if (timer) clearInterval(timer); },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

export const service: ServerService = {
  id: "live",
  label: "Live run",
  about: "Streams runs/latest.jsonl as a run writes it, so robots appear and move while they work.",
  routes: [{ method: "GET", path: "stream", handle: (req) => stream(req) }],
  async health() {
    const take = liveTake();
    return take ? { status: "ok", summary: `Take ${take} is writing now.`, detail: { take } } : { status: "idle", summary: "No run is writing to runs/latest.jsonl right now." };
  },
};
