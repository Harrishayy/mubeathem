import type { Moment, Persona, Receptivity } from '../taxonomy';
import { MOMENT_META, PERSONA_LABEL, situationKey } from '../taxonomy';
import type { Evidence, LineStats, PlaybookLine, Situation } from '../schema/domain';
import { formatMultiplier } from '../format';

/** Below this many shows in a situation, rank on the line's moment-wide `*` totals instead. */
export const BACKOFF_SHOWS = 5;
/** A line with fewer total shows than this is young enough for the exploration slot. */
export const YOUNG_SHOWS = 10;
/** The stats key holding a line's totals across every situation. */
export const TOTAL_KEY = '*';

export interface RankedLine {
  line: PlaybookLine;
  /** This draw's Thompson sample of the line's step-win rate. */
  sampledWinRate: number;
  /** The stats the sample was drawn from (situation-level, or `*` when backed off). */
  stats: LineStats;
  evidence: Evidence;
}

export interface RankOptions {
  /** How many lines to return. Default 3. */
  k?: number;
  /** Uniform [0, 1) source. Pass a seeded one for determinism; defaults to `Math.random`. */
  rng?: () => number;
  /** Reserve the last slot for a young line when none made the cut on merit. Default true. */
  exploreSlot?: boolean;
}

const ZERO: LineStats = { shown: 0, used: 0, stepWins: 0, booked: 0, lost: 0 };

/** A line's stats for a key, zeros when absent. */
export function statsFor(line: PlaybookLine, key: string): LineStats {
  return line.stats[key] ?? ZERO;
}

/** Wins and trials for a line: step wins out of the times the rep actually said it. */
function winsAndTrials(st: LineStats): { wins: number; trials: number } {
  const trials = Math.max(st.used, st.stepWins);
  return { wins: st.stepWins, trials };
}

/** The stats that decide a line's rank for a situation: the situation's own, or `*` when too thin. */
function rankingStats(line: PlaybookLine, key: string): { stats: LineStats; backedOff: boolean } {
  const own = statsFor(line, key);
  if (own.shown >= BACKOFF_SHOWS) return { stats: own, backedOff: false };
  return { stats: statsFor(line, TOTAL_KEY), backedOff: true };
}

/* ───────────── Beta sampling ───────────── */

function normal(rng: () => number): number {
  // Box–Muller; guard against log(0).
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Marsaglia–Tsang gamma sampler, shape ≥ 1 (Beta(1 + w, 1 + l) never needs less). */
function gamma(shape: number, rng: () => number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Acceptance is > 95% per round; the cap only matters for a degenerate rng (e.g. a constant).
  for (let round = 0; round < 64; round++) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(rng(), 1e-12);
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return shape;
}

/** One draw from Beta(a, b), a, b ≥ 1. */
export function sampleBeta(a: number, b: number, rng: () => number): number {
  const x = gamma(a, rng);
  const y = gamma(b, rng);
  return x / (x + y);
}

/* ───────────── evidence ───────────── */

const WIN_VERB: Record<string, string> = {
  get_through: 'Got through',
  earn_time: 'Earned the next 30 seconds',
  keep_alive: 'Kept the call going',
  book: 'Booked',
  protect: 'Kept it clean',
  none: 'Worked',
};

function audience(key: string): string | null {
  const [persona, receptivity] = key.split('.') as [Persona | undefined, Receptivity | undefined];
  if (!persona || !receptivity || !(persona in PERSONA_LABEL)) return null;
  const who: Record<Persona, string> = {
    gatekeeper: 'gatekeepers',
    ceo: 'CEOs',
    cfo: 'CFOs',
    engineer: 'engineers',
    other_exec: 'execs',
    unknown: 'prospects',
  };
  const mood: Record<Receptivity, string> = { warm: 'warm ', neutral: '', cool: 'cooling ', cold: 'cold ' };
  return `${mood[receptivity] ?? ''}${who[persona]}`;
}

function rate(st: LineStats): number {
  const { wins, trials } = winsAndTrials(st);
  return trials > 0 ? wins / trials : 0;
}

/**
 * The card's evidence sentence for a line in a situation: "Booked 11 of 34 times here",
 * "2.1× the straight answer with cold CEOs · 41 calls", or "New line, getting a fair trial".
 * Pass `peers` (other lines for the moment) to allow the comparison against the straight answer.
 */
export function evidenceFor(line: PlaybookLine, key: string, peers: PlaybookLine[] = []): Evidence {
  const total = statsFor(line, TOTAL_KEY);
  const { stats, backedOff } = rankingStats(line, key);
  const job = MOMENT_META[line.moment].job;
  const isBook = job === 'book';
  const wins = isBook ? stats.booked : stats.stepWins;
  const calls = Math.max(stats.used, wins);

  if (total.shown < YOUNG_SHOWS || calls === 0) {
    return { text: 'New line, getting a fair trial', calls, ...(calls > 0 ? { winRate: wins / calls } : {}), basis: 'explore' };
  }

  const winRate = wins / calls;

  if (!backedOff && line.style !== 'straight') {
    const who = audience(key);
    const straight = peers
      .filter((p) => p.id !== line.id && p.moment === line.moment && p.style === 'straight')
      .map((p) => statsFor(p, key))
      .filter((s) => s.used >= BACKOFF_SHOWS)
      .sort((a, b) => b.used - a.used)[0];
    if (who && straight) {
      const base = isBook ? (straight.used ? straight.booked / straight.used : 0) : rate(straight);
      const ratio = base > 0 ? winRate / base : 0;
      if (ratio >= 1.3) {
        return { text: `${formatMultiplier(ratio)} the straight answer with ${who} · ${calls} calls`, calls, winRate, basis: 'bandit' };
      }
    }
  }

  const where = backedOff ? 'across the team' : 'here';
  return { text: `${WIN_VERB[job]} ${wins} of ${calls} times ${where}`, calls, winRate, basis: 'bandit' };
}

/* ───────────── ranking ───────────── */

function eligible(lines: PlaybookLine[], moment: Moment, persona: Persona, receptivity: Receptivity): PlaybookLine[] {
  const forMoment = lines.filter((l) => l.status === 'active' && l.moment === moment);
  const exact = forMoment.filter(
    (l) => (l.personas.length === 0 || l.personas.includes(persona)) && (l.receptivity.length === 0 || l.receptivity.includes(receptivity)),
  );
  return exact.length > 0 ? exact : forMoment;
}

/**
 * Top lines for a situation by Thompson sampling on Beta(1 + step wins, 1 + misses), using the
 * situation's own stats or, below `BACKOFF_SHOWS` shows, the line's `*` totals. Proven lines rank
 * first; with `exploreSlot` the last slot goes to the best-sampled young line (< `YOUNG_SHOWS` shows).
 */
export function rankLines(lines: PlaybookLine[], s: Pick<Situation, 'persona' | 'receptivity' | 'moment'>, opts: RankOptions = {}): RankedLine[] {
  const k = Math.max(0, Math.floor(opts.k ?? 3));
  const rng = opts.rng ?? Math.random;
  const exploreSlot = opts.exploreSlot ?? true;
  const key = situationKey(s);
  const pool = eligible(lines, s.moment, s.persona, s.receptivity);
  if (k === 0 || pool.length === 0) return [];

  const sampled = pool.map((line) => {
    const { stats } = rankingStats(line, key);
    const { wins, trials } = winsAndTrials(stats);
    return { line, stats, sampledWinRate: sampleBeta(1 + wins, 1 + Math.max(0, trials - wins), rng) };
  });
  // Ties (rare with continuous samples) break on id so the order is total.
  sampled.sort((a, b) => b.sampledWinRate - a.sampledWinRate || a.line.id.localeCompare(b.line.id));

  // Proven lines compete on their samples; a young line's wide posterior would otherwise take the
  // top slot too often. Young lines get the exploration slot, or fill in when proven ones run out.
  const isYoung = (l: PlaybookLine) => statsFor(l, TOTAL_KEY).shown < YOUNG_SHOWS;
  const proven = sampled.filter((p) => !isYoung(p.line));
  const young = sampled.filter((p) => isYoung(p.line));
  let picked = [...proven, ...young].slice(0, k);
  if (exploreSlot && k >= 2 && young.length > 0 && !picked.some((p) => isYoung(p.line))) {
    picked = [...picked.slice(0, k - 1), young[0]!];
  }

  return picked.map((p) => ({
    line: p.line,
    sampledWinRate: p.sampledWinRate,
    stats: p.stats,
    evidence: evidenceFor(p.line, key, pool),
  }));
}
