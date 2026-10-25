// Practice: starts and stops `python -m steward.practice` from the console. Its events go
// to runs/latest.jsonl, so the live service streams them in as the robots work.
//
//   GET    /api/practice   status, with the last lines of output
//   POST   /api/practice   { episodes, workers, offline, seed? } -> status
//   DELETE /api/practice   stop the run
//
// One run at a time. A live run (offline: false) makes real Mubit calls and needs
// MUBIT_API_KEY; offline runs use steward/offline.py and cost nothing.

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { env, repoRoot, runsDir } from "../server/env";
import { fail, json, readJson } from "../server/http";
import type { ServerService } from "../server/types";
import type { PracticeArgs, PracticeStatus } from "../types";

interface Run { proc: ChildProcess | null; args: PracticeArgs | null; startedAt: number | null; endedAt: number | null; exitCode: number | null; output: string[] }
// Kept on globalThis so a dev-server reload doesn't lose track of a running process.
const g = globalThis as unknown as { __stewardPractice?: Run };
const run: Run = (g.__stewardPractice ||= { proc: null, args: null, startedAt: null, endedAt: null, exitCode: null, output: [] });

const python = () => env("STEWARD_PYTHON") || "python3";
const MAX_LINES = 60;

function status(): PracticeStatus {
  return {
    running: !!run.proc && run.exitCode == null, pid: run.proc?.pid ?? null, args: run.args,
    startedAt: run.startedAt, endedAt: run.endedAt, exitCode: run.exitCode, output: run.output.slice(-MAX_LINES),
    python: python(), canRunLive: !!env("MUBIT_API_KEY"),
  };
}

const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

async function start(req: Request) {
  if (run.proc && run.exitCode == null) return fail(409, "busy", "A practice run is already going. Stop it first.", { status: status() });
  const b = (await readJson<Partial<PracticeArgs>>(req)) || {};
  const args: PracticeArgs = { episodes: int(b.episodes, 1, 200, 6), workers: int(b.workers, 1, 8, 2), offline: b.offline !== false, seed: b.seed == null ? null : int(b.seed, 0, 1e9, 0) };
  if (!args.offline && !env("MUBIT_API_KEY")) return fail(400, "no_key", "A live run needs MUBIT_API_KEY. Run offline, or set the key in the repo's .env.");
  const argv = ["-m", "steward.practice", "--episodes", String(args.episodes), "--workers", String(args.workers)];
  if (args.offline) argv.push("--offline");
  if (args.seed != null) argv.push("--seed", String(args.seed));
  Object.assign(run, { args, startedAt: Date.now() / 1000, endedAt: null, exitCode: null, output: [`$ ${python()} ${argv.join(" ")}`] });
  const proc = spawn(/*turbopackIgnore: true*/ python(), argv, { cwd: path.resolve(/*turbopackIgnore: true*/ repoRoot()), env: { ...process.env, STEWARD_RUNS_DIR: runsDir(), PYTHONUNBUFFERED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  run.proc = proc;
  const take = (chunk: Buffer) => { for (const l of chunk.toString("utf8").split("\n")) if (l.trim()) run.output.push(l); if (run.output.length > MAX_LINES * 2) run.output.splice(0, run.output.length - MAX_LINES); };
  proc.stdout?.on("data", take);
  proc.stderr?.on("data", take);
  proc.on("error", (e) => { run.output.push(`Couldn't start ${python()}: ${e.message}. Set STEWARD_PYTHON to the Python that has Steward's requirements.`); run.exitCode = -1; run.endedAt = Date.now() / 1000; });
  proc.on("exit", (code, signal) => { run.exitCode = code ?? (signal ? 130 : -1); run.endedAt = Date.now() / 1000; if (signal) run.output.push(`Stopped (${signal}).`); });
  return json(status(), 202);
}

function stop() {
  if (!run.proc || run.exitCode != null) return json(status());
  run.proc.kill("SIGTERM");
  setTimeout(() => { if (run.exitCode == null) run.proc?.kill("SIGKILL"); }, 4000);
  return json(status());
}

export const service: ServerService = {
  id: "practice",
  label: "Practice runner",
  about: "Starts python -m steward.practice: the full loop on the text-only world, live through Mubit or offline with scripted stand-ins.",
  env: [{ key: "STEWARD_PYTHON", about: "Python with Steward's requirements (default python3)." }],
  routes: [
    { method: "GET", path: "", handle: () => json(status()) },
    { method: "POST", path: "", handle: start },
    { method: "DELETE", path: "", handle: stop },
  ],
  async health() {
    const s = status();
    if (s.running) return { status: "ok", summary: `Running ${s.args?.episodes} episodes on ${s.args?.workers} worker${s.args?.workers === 1 ? "" : "s"}${s.args?.offline ? ", offline" : " through Mubit"}.`, detail: { pid: s.pid } };
    return { status: "idle", summary: s.exitCode == null ? `Ready. Uses ${s.python}${s.canRunLive ? "" : "; offline only until MUBIT_API_KEY is set"}.` : `Last run exited with code ${s.exitCode}.` };
  },
};
