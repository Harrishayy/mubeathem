import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Everything the server reads from its environment. Secrets live here and nowhere else. */
export interface ServerConfig {
  port: number;
  /** Absolute path, or `:memory:`. */
  dbPath: string;
  /** Exact origins, or patterns with a trailing `*` (e.g. `chrome-extension://*`). */
  allowedOrigins: string[];
  /** Empty = no auth (local dev only). */
  apiToken: string;
  trellus: { apiKey: string; teamId: string; pollSeconds: number };
  exaApiKey: string;
  saplingUrl: string;
  /** Speech-to-text: the browser gets short-lived Deepgram tokens from `POST /api/stt/token`, never this key. */
  stt: { deepgramApiKey: string; ttlSeconds: number };
  /** Per-stage budgets on the live path; past them the rules engine answers. */
  budgets: { readMs: number; writeMs: number; checkMs: number; briefMs: number; reviewMs: number; simMs: number };
  /** SSE heartbeat comment interval. */
  heartbeatMs: number;
  /** Review a call this long after it ended with an outcome, if the rep never sent feedback. */
  autoReviewAfterMs: number;
  /** The seller, for research_brief and write_line. */
  seller: { company: string; offer: string };
}

function int(raw: string | undefined, fallback: number, min = 0): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

function str(raw: string | undefined): string {
  return (raw ?? '').trim();
}

/** Expands `~` and resolves relative paths against the process cwd. */
export function expandPath(p: string): string {
  if (p === ':memory:') return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const origins = str(env.CUE_ALLOWED_ORIGINS) || 'http://localhost:5173,chrome-extension://*';
  return {
    port: int(env.CUE_PORT ?? env.PORT, 8787, 0),
    dbPath: expandPath(str(env.CUE_DB_PATH) || '~/.cue/cue.db'),
    allowedOrigins: origins
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    apiToken: str(env.CUE_API_TOKEN),
    trellus: { apiKey: str(env.TRELLUS_API_KEY), teamId: str(env.TRELLUS_TEAM_ID), pollSeconds: int(env.TRELLUS_POLL_SECONDS, 60) },
    exaApiKey: str(env.EXA_API_KEY),
    saplingUrl: str(env.SAPLING_URL),
    stt: { deepgramApiKey: str(env.DEEPGRAM_API_KEY), ttlSeconds: Math.min(3600, int(env.CUE_STT_TTL_SECONDS, 60, 1)) },
    budgets: {
      readMs: int(env.CUE_READ_BUDGET_MS, 2500, 1),
      writeMs: int(env.CUE_WRITE_BUDGET_MS, 3000, 1),
      checkMs: int(env.CUE_CHECK_BUDGET_MS, 2000, 1),
      briefMs: int(env.CUE_BRIEF_BUDGET_MS, 12_000, 1),
      reviewMs: int(env.CUE_REVIEW_BUDGET_MS, 30_000, 1),
      simMs: int(env.CUE_SIM_BUDGET_MS, 8000, 1),
    },
    heartbeatMs: int(env.CUE_HEARTBEAT_MS, 15_000, 10),
    autoReviewAfterMs: int(env.CUE_AUTO_REVIEW_AFTER_MS, 10 * 60_000, 0),
    seller: {
      company: str(env.CUE_SELLER_COMPANY) || 'Corgi',
      offer: str(env.CUE_SELLER_OFFER) || 'AI-native insurance for startups: D&O, E&O, cyber, EPLI and AI liability, quoted in minutes',
    },
  };
}

/** True when `origin` matches one of the allowed entries (exact, or prefix before a trailing `*`). */
export function originAllowed(origin: string, allowed: string[]): boolean {
  return allowed.some((a) => (a.endsWith('*') ? origin.startsWith(a.slice(0, -1)) : origin === a));
}
