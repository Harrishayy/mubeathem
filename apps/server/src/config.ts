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
  /** Valyu search (web + news + proprietary sources), run beside Exa for the pre-call brief. */
  valyuApiKey: string;
  /** Pre-call research: per-provider timeout and how long findings are reused for the same person. */
  research: { timeoutMs: number; cacheMinutes: number };
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
  /** Local trace of every Mubit call (store/traces.ts). Bodies follow CUE_MUBIT_RECORD. */
  traces: { retentionDays: number; maxBodyBytes: number; flushMs: number; flushRows: number };
  /**
   * The latency layers on the live path (architecture.md §5.3): an instant card before any model
   * call, endpointing on interims, Mubit refinement in place, and standby lines for predicted moments.
   */
  latency: {
    /** Show the rules/standby card the moment a prospect turn ends, then refine it in place. */
    instant: boolean;
    /** Start the turn on an interim that looks finished, before the transcriber's final. */
    earlyTrigger: boolean;
    /** Also start the Mubit read/write on that early trigger (not only the instant card). */
    earlyMubit: boolean;
    /** Unchanged-interim silence that counts as the end of an unpunctuated sentence. */
    endpointPauseMs: number;
    /** A refined version may replace the instant card until this long after the final transcript (and never once the rep speaks or acts). */
    refineWindowMs: number;
    /** Predicted next moments to pre-write with Mubit while the rep talks (0 = off). */
    standby: number;
    /** Warm the Mubit connection when a prospect starts speaking. */
    warm: boolean;
  };
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
    valyuApiKey: str(env.VALYU_API_KEY),
    research: { timeoutMs: int(env.CUE_RESEARCH_TIMEOUT_MS, 6000, 500), cacheMinutes: int(env.CUE_RESEARCH_CACHE_MINUTES, 720) },
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
    latency: {
      instant: env.CUE_INSTANT_CARD !== '0',
      earlyTrigger: env.CUE_EARLY_TRIGGER !== '0',
      earlyMubit: env.CUE_EARLY_MUBIT !== '0',
      endpointPauseMs: int(env.CUE_ENDPOINT_PAUSE_MS, 250, 50),
      refineWindowMs: int(env.CUE_REFINE_WINDOW_MS, 500, 0),
      standby: Math.min(3, int(env.CUE_STANDBY, 2)),
      warm: env.CUE_WARM_MUBIT !== '0',
    },
    traces: {
      retentionDays: int(env.CUE_TRACE_RETENTION_DAYS, 0),
      maxBodyBytes: int(env.CUE_TRACE_MAX_BODY_BYTES, 64 * 1024, 256),
      flushMs: int(env.CUE_TRACE_FLUSH_MS, 250, 1),
      flushRows: int(env.CUE_TRACE_FLUSH_ROWS, 50, 1),
    },
  };
}

/** True when `origin` matches one of the allowed entries (exact, or prefix before a trailing `*`). */
export function originAllowed(origin: string, allowed: string[]): boolean {
  return allowed.some((a) => (a.endsWith('*') ? origin.startsWith(a.slice(0, -1)) : origin === a));
}
