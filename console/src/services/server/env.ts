// Where Steward lives and what its .env says. Server only: never import from a client file.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Paths here are only known at runtime (they come from the working directory and .env),
// so they are marked turbopackIgnore: otherwise the build traces the whole repo into the
// server bundle.

/** The Steward repo root: STEWARD_ROOT, else the first folder up from here that has steward/loop.py. */
export function repoRoot(): string {
  if (process.env.STEWARD_ROOT) return path.resolve(/*turbopackIgnore: true*/ process.env.STEWARD_ROOT);
  let dir = path.resolve(/*turbopackIgnore: true*/ process.cwd());
  for (let i = 0; i < 4; i++) {
    if (existsSync(path.join(dir, "steward", "loop.py"))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
}

let fileEnv: Record<string, string> | null = null;
/** process.env first, then the repo's .env, the same precedence steward/config.py uses. */
export function env(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  if (!fileEnv) {
    fileEnv = {};
    const p = path.join(repoRoot(), ".env");
    if (existsSync(p)) {
      for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const i = line.indexOf("=");
        const k = line.slice(0, i).trim();
        if (!(k in fileEnv)) fileEnv[k] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }
  return fileEnv[key] || undefined;
}

/** Steward's runs dir (STEWARD_RUNS_DIR, else <repo>/runs). Resolved against the repo root. */
export function runsDir(): string {
  const v = env("STEWARD_RUNS_DIR");
  return v ? path.resolve(repoRoot(), v) : path.join(repoRoot(), "runs");
}

/** Services named in STEWARD_SERVICES_OFF (comma-separated) are unplugged at runtime. */
export function disabledServices(): string[] {
  return (env("STEWARD_SERVICES_OFF") || "").split(",").map((s) => s.trim()).filter(Boolean);
}
