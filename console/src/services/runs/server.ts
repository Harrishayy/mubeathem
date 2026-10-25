// Runs: Steward's takes in the runs dir (runs/takes/<take>.jsonl, the contract in
// steward/EVENTS.md) and the video beside them.
//
//   GET /api/runs                every real take, summarised
//   GET /api/runs/:take          one take: its summary and every event, with `vt` when it has video
//   GET /api/runs/:take/video    the player copy (runs/web) when prepared, else the wide recording
//   GET /api/runs/:take/pov      the head camera, for takes without a player copy
//
// Takes marked offline (steward/offline.py's scripted stand-ins) or fixture are never served.

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { runsDir } from "../server/env";
import { fail, json, sendFile } from "../server/http";
import type { ServerService } from "../server/types";
import type { RawEvent, RunsList, TakeDetail, TakeSummary, TakeVideo } from "../types";

/** A take is "live" while runs/latest.jsonl is that take and was written this recently. Isaac
 *  phases run for half a minute or more between log lines, so this is generous. */
const LIVE_SECONDS = 90;
const TAKE_ID = /^[\w.-]+$/;

const takesDir = () => path.join(runsDir(), "takes");
const fileOf = (id: string, ext: string) => path.join(takesDir(), `${id}${ext}`);

interface Frames { fps: number; times: number[] }
interface Parsed { key: string; events: RawEvent[]; frames: Frames | null }
// Parsed takes, keyed by file size and mtime, so listing the runs dir stays cheap.
const g = globalThis as unknown as { __stewardTakes?: Map<string, Parsed> };
const cache: Map<string, Parsed> = (g.__stewardTakes ||= new Map());

function readFrames(id: string): Frames | null {
  const p = fileOf(id, ".frames.json");
  if (!existsSync(p)) return null;
  try {
    const v = JSON.parse(readFileSync(p, "utf8"));
    // Older takes wrote a bare list of frame times at 20 fps (video/prepare.py frame_info).
    if (Array.isArray(v)) return { fps: 20, times: v };
    return Array.isArray(v?.times) && v.fps ? { fps: Number(v.fps), times: v.times } : null;
  } catch { return null; }
}

/** Seconds into the video of the first frame after unix time t, as the player computes it. */
function videoTime(t: number, f: Frames): number {
  let lo = 0, hi = f.times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (f.times[mid] < t) lo = mid + 1; else hi = mid; }
  return Math.max(0, Math.min(lo / f.fps, (f.times.length - 1) / f.fps - 0.15));
}

function parse(id: string): Parsed | null {
  const p = fileOf(id, ".jsonl");
  if (!existsSync(p)) return null;
  const st = statSync(p), fp = fileOf(id, ".frames.json");
  const key = `${st.size}:${st.mtimeMs}:${existsSync(fp) ? statSync(fp).mtimeMs : 0}`;
  const hit = cache.get(id);
  if (hit?.key === key) return hit;
  const events: RawEvent[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* a line caught mid-write; the next read has it */ }
  }
  const frames = readFrames(id);
  if (frames) for (const e of events) if (typeof e.t === "number") e.vt = videoTime(e.t, frames);
  const parsed = { key, events, frames };
  cache.set(id, parsed);
  return parsed;
}

const takeLine = (events: RawEvent[]) => events.find((e) => e.kind === "take");

/** Real: not marked offline or fixture, and no call answered by an offline stand-in. */
export function isReal(events: RawEvent[]): boolean {
  const t = takeLine(events);
  if (t?.offline === true || t?.fixture === true || t?.verifier === "sapling-offline") return false;
  return !events.some((e) => e.kind === "call" && (e.via === "offline" || e.via === "sapling-offline"));
}

/** The take runs/latest.jsonl holds, while it is still being written. */
export function liveTake(): string | null {
  const p = path.join(runsDir(), "latest.jsonl");
  if (!existsSync(p)) return null;
  const st = statSync(p);
  if (Date.now() - st.mtimeMs > LIVE_SECONDS * 1000) return null;
  const fd = openSync(p, "r");
  try {
    const buf = Buffer.alloc(Math.min(st.size, 64 * 1024));
    const first = buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString("utf8").split("\n")[0];
    const id = JSON.parse(first)?.take;
    return typeof id === "string" && TAKE_ID.test(id) ? id : null;
  } catch { return null; } finally { closeSync(fd); }
}

/** The take's lesson file relative to the runs dir. `lessons_file` is the path on the machine that ran it. */
function lessonsFile(id: string, logged: unknown): string | null {
  const dir = runsDir();
  if (typeof logged === "string" && logged) {
    const rel = path.isAbsolute(logged) ? path.relative(dir, logged) : logged;
    if (!rel.startsWith("..") && existsSync(path.join(dir, rel))) return rel;
    for (const rel2 of [path.basename(logged), path.join("takes", path.basename(logged))]) if (existsSync(path.join(dir, rel2))) return rel2;
  }
  const own = path.join("takes", `${id}.lessons.json`);
  return existsSync(path.join(dir, own)) ? own : null;
}

function video(id: string, frames: Frames | null): TakeVideo | null {
  if (!frames || !frames.times.length) return null;
  const prepared = existsSync(path.join(runsDir(), "web", `${id}.mp4`));
  if (!prepared && !existsSync(fileOf(id, ".mp4"))) return null;
  return { prepared, pov: existsSync(fileOf(id, ".pov.mp4")), fps: frames.fps, duration: frames.times.length / frames.fps };
}

function summarise(id: string, p: Parsed, live: string | null): TakeSummary {
  const ev = p.events, t = takeLine(ev);
  const robots = [...new Set(ev.map((e) => e.robot).filter((r): r is string => typeof r === "string"))].sort();
  // Each attempt's outcome: its result, else "stopped" if the robot's task ended without one.
  const outcomes: Record<string, number> = {};
  const open = new Map<string, boolean>();
  const close = (robot: string, o: string) => { if (open.get(robot)) outcomes[o] = (outcomes[o] || 0) + 1; open.set(robot, false); };
  for (const e of ev) {
    if (!e.robot) continue;
    if (e.kind === "attempt") { if (open.get(e.robot)) close(e.robot, "stopped"); open.set(e.robot, true); }
    else if (e.kind === "result") close(e.robot, e.success ? "success" : "failed");
    else if (e.kind === "outcome") close(e.robot, "stopped");
  }
  const results = ev.filter((e) => e.kind === "result");
  return {
    id, mode: String(t?.mode || "unknown"), offline: t?.offline === true, fixture: t?.fixture === true,
    verifier: t?.verifier ?? null, model: t?.model ?? null,
    started: ev[0]?.t ?? 0, ended: ev[ev.length - 1]?.t ?? 0, events: ev.length, robots,
    attempts: ev.filter((e) => e.kind === "attempt").length, outcomes,
    story: results.map((e) => (e.success ? "lands" : "spills")).join(" → ") || "no result",
    lessonsFile: lessonsFile(id, t?.lessons_file), video: video(id, p.frames),
    live: live === id, bytes: statSync(fileOf(id, ".jsonl")).size,
  };
}

function realTakes(): { id: string; p: Parsed }[] {
  if (!existsSync(takesDir())) return [];
  const out: { id: string; p: Parsed }[] = [];
  for (const f of readdirSync(takesDir())) {
    if (!f.endsWith(".jsonl")) continue;
    const id = f.slice(0, -".jsonl".length), p = TAKE_ID.test(id) ? parse(id) : null;
    if (p && p.events.length && isReal(p.events)) out.push({ id, p });
  }
  return out;
}

export function listTakes(): RunsList {
  const live = liveTake();
  const takes = realTakes().map(({ id, p }) => summarise(id, p, live)).sort((a, b) => a.started - b.started);
  return { dir: runsDir(), exists: existsSync(runsDir()), takes };
}

/** A take the service will serve, or null (a bad id, no such file, or not a real take). */
function realTake(id: string): Parsed | null {
  if (!TAKE_ID.test(id)) return null;
  const p = parse(id);
  return p && p.events.length && isReal(p.events) ? p : null;
}

/** Whether a take is one the console shows. Its lesson file is listed only if so. */
export const isRealTake = (id: string) => !!realTake(id);

const notFound = (id: string) => fail(404, "no_take", `No real take "${id}" in ${takesDir()}.`);

export const service: ServerService = {
  id: "runs",
  label: "Runs",
  about: "Reads Steward's takes from the runs dir, puts each event on its video's timeline, and serves the video.",
  env: [{ key: "STEWARD_RUNS_DIR", about: "Where Steward's runs are read from (default <repo>/runs)." }],
  routes: [
    { method: "GET", path: "", handle: () => json(listTakes()) },
    {
      method: "GET", path: ":take",
      handle(_req, { take }) {
        const p = realTake(take);
        if (!p) return notFound(take);
        return json({ summary: summarise(take, p, liveTake()), events: p.events } satisfies TakeDetail);
      },
    },
    {
      method: "GET", path: ":take/video",
      handle(req, { take }) {
        if (!realTake(take)) return notFound(take);
        const web = path.join(runsDir(), "web", `${take}.mp4`), raw = fileOf(take, ".mp4");
        const file = existsSync(web) ? web : existsSync(raw) ? raw : null;
        return file ? sendFile(req, file, "video/mp4") : fail(404, "no_video", `Take ${take} has no video.`);
      },
    },
    {
      method: "GET", path: ":take/pov",
      handle(req, { take }) {
        if (!realTake(take)) return notFound(take);
        const file = fileOf(take, ".pov.mp4");
        return existsSync(file) ? sendFile(req, file, "video/mp4") : fail(404, "no_video", `Take ${take} has no head-camera video.`);
      },
    },
  ],
  async health() {
    const { dir, exists, takes } = listTakes();
    if (!exists) return { status: "error", summary: `${dir} doesn't exist. Set STEWARD_RUNS_DIR.` };
    const withVideo = takes.filter((t) => t.video).length;
    return takes.length
      ? { status: "ok", summary: `${takes.length} take${takes.length === 1 ? "" : "s"} in ${dir}, ${withVideo} with video.`, detail: { dir } }
      : { status: "idle", summary: `No takes in ${dir} yet.`, detail: { dir } };
  },
};
