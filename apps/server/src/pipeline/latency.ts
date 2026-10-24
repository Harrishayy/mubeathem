/**
 * The latency layer's decisions, kept pure so they are unit tested (architecture.md §5.3):
 * when a refined card may replace the instant one, and the per-call standby lines written ahead
 * for predicted moments.
 */
import type { Moment, Persona, Suggestion, UpNext } from '@cue/core';
import type { RankedLine } from '../adapters/core';

/* ───────── swap policy ───────── */

export interface ShownCard {
  moment: Moment;
  confidence: number;
  say: string;
  servedBy: Suggestion['servedBy'];
  /** When the window starts: the prospect finished (final transcript), or the card was shown. */
  shownAt: number;
}

export interface CandidateCard {
  moment: Moment;
  confidence: number;
  say: string;
  servedBy: Suggestion['servedBy'];
}

export interface SwapContext {
  now: number;
  /** When the rep started talking after this prospect turn (first rep interim), or null. */
  repSpokeAt: number | null;
  /** The rep used, edited, dismissed or rated the card. */
  acted: boolean;
  /** Max ms after `shownAt` that the card may still change. */
  windowMs: number;
}

export type SwapDecision =
  | { swap: true; reason: 'upgrade' | 'correct' }
  | { swap: false; reason: 'acted' | 'rep_speaking' | 'too_late' | 'same_text' | 'not_better' | 'keep_moment' };

/** How much more sure the model must be to change the moment of a card already on screen. */
export const CORRECT_MARGIN = 0.1;
/** Below this, an instant card's moment is a guess that the model may always correct. */
export const WEAK_MOMENT = 0.6;

const RANK: Record<Suggestion['servedBy'], number> = { rules: 0, cache: 1, mubit: 2 };

/**
 * Should `next` replace the card on screen? Never once the rep acted on it or started talking,
 * never after the window, never a downgrade (model → rules). Same moment: upgrade the wording.
 * Different moment: when the instant read was weak, a model read (≥ WEAK_MOMENT) replaces a rules
 * card, or the newcomer is clearly surer.
 */
export function swapDecision(shown: ShownCard, next: CandidateCard, ctx: SwapContext): SwapDecision {
  if (ctx.acted) return { swap: false, reason: 'acted' };
  if (ctx.repSpokeAt !== null && ctx.repSpokeAt <= ctx.now) return { swap: false, reason: 'rep_speaking' };
  if (ctx.now - shown.shownAt > ctx.windowMs) return { swap: false, reason: 'too_late' };
  if (RANK[next.servedBy] < RANK[shown.servedBy]) return { swap: false, reason: 'not_better' };
  if (next.moment === shown.moment) {
    if (next.say.trim() === shown.say.trim()) return { swap: false, reason: 'same_text' };
    return { swap: true, reason: 'upgrade' };
  }
  // The instant read is the rules engine's; a model read that is reasonably sure outranks it.
  const modelOverRules = RANK[next.servedBy] > RANK[shown.servedBy] && next.confidence >= WEAK_MOMENT;
  if (shown.confidence < WEAK_MOMENT || modelOverRules || next.confidence >= shown.confidence + CORRECT_MARGIN) return { swap: true, reason: 'correct' };
  return { swap: false, reason: 'keep_moment' };
}

/** A card nobody has seen yet (the instant layer stayed quiet) may still appear until the rep replies. */
export function lateCardAllowed(ctx: Pick<SwapContext, 'now' | 'repSpokeAt'>): boolean {
  return ctx.repSpokeAt === null || ctx.repSpokeAt > ctx.now;
}

/* ───────── standby lines ───────── */

export interface StandbyLine {
  say: string;
  why: string;
  upNext: UpNext[];
  chosen: RankedLine;
  requestId: string | null;
}

export interface StandbyEntry {
  moment: Moment;
  persona: Persona;
  /** Prospect turn count when it was written; entries go stale after `maxAgeTurns`. */
  turnCount: number;
  createdAt: number;
  ranked: RankedLine[];
  controller: AbortController;
  /** Resolves to the line, or null when the write failed or the line was unsafe. */
  promise: Promise<StandbyLine | null>;
  ready: StandbyLine | null;
  settled: boolean;
}

/**
 * Per-call standby lines keyed by moment. Written by Mubit while the rep is talking, for the moments
 * the last card predicted (`upNext`), so a matching prospect turn gets a tailored line instantly.
 * Each line is served once; persona must match (a gatekeeper line is no use once the CEO is on).
 */
export class StandbyCache {
  private calls = new Map<string, Map<Moment, StandbyEntry>>();
  hits = 0;
  misses = 0;

  constructor(
    private maxAgeTurns = 3,
    private maxAgeMs = 120_000,
  ) {}

  private fresh(e: StandbyEntry, turnCount: number, now: number): boolean {
    return turnCount - e.turnCount <= this.maxAgeTurns && now - e.createdAt <= this.maxAgeMs;
  }

  has(callId: string, moment: Moment, persona: Persona, turnCount: number, now: number): boolean {
    const e = this.calls.get(callId)?.get(moment);
    return !!e && e.persona === persona && this.fresh(e, turnCount, now) && (!e.settled || !!e.ready);
  }

  put(callId: string, entry: StandbyEntry): void {
    let m = this.calls.get(callId);
    if (!m) this.calls.set(callId, (m = new Map()));
    m.get(entry.moment)?.controller.abort('replaced');
    m.set(entry.moment, entry);
    void entry.promise.then(
      (line) => {
        entry.ready = line;
        entry.settled = true;
      },
      () => {
        entry.settled = true;
      },
    );
  }

  /** A finished line for the moment, removed so it is served once. */
  takeReady(callId: string, moment: Moment, persona: Persona, turnCount: number, now: number): StandbyLine | null {
    const m = this.calls.get(callId);
    const e = m?.get(moment);
    if (!e || !e.ready || e.persona !== persona || !this.fresh(e, turnCount, now)) {
      this.misses++;
      return null;
    }
    m!.delete(moment);
    this.hits++;
    return e.ready;
  }

  /** A line still being written for the moment (the refinement can wait on it instead of writing again). */
  takePending(callId: string, moment: Moment, persona: Persona, turnCount: number, now: number): StandbyEntry | null {
    const m = this.calls.get(callId);
    const e = m?.get(moment);
    if (!e || e.settled || e.persona !== persona || !this.fresh(e, turnCount, now)) return null;
    m!.delete(moment);
    return e;
  }

  /** In-flight writes, for `idle()`. */
  pending(): Promise<unknown>[] {
    return [...this.calls.values()].flatMap((m) => [...m.values()].filter((e) => !e.settled).map((e) => e.promise.catch(() => null)));
  }

  /** Drops stale entries and aborts the writes for moments that can no longer match. */
  prune(callId: string, turnCount: number, now: number, keep: (e: StandbyEntry) => boolean = () => true): void {
    const m = this.calls.get(callId);
    if (!m) return;
    for (const [k, e] of m) {
      if (!this.fresh(e, turnCount, now) || !keep(e)) {
        e.controller.abort('stale');
        m.delete(k);
      }
    }
  }

  clear(callId: string): void {
    const m = this.calls.get(callId);
    if (!m) return;
    for (const e of m.values()) e.controller.abort('call ended');
    this.calls.delete(callId);
  }

  size(callId: string): number {
    return this.calls.get(callId)?.size ?? 0;
  }
}

/** Moments worth a standby line after a card: the one we're in (prospects repeat), then the card's predictions. */
export function standbyMoments(current: Moment, upNext: UpNext[], n: number, suggests: (m: Moment) => boolean): Moment[] {
  const out: Moment[] = [];
  for (const m of [current, ...upNext.map((u) => u.moment)]) {
    if (out.length >= n) break;
    if (suggests(m) && !out.includes(m)) out.push(m);
  }
  return out;
}
