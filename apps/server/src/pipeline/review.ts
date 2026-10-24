import { OUTCOME_LABEL, OUTCOMES, type CallRecord, type CallReview, type CallView, type LineStats, type Outcome, type PlaybookLine, type ReviewCallOutput } from '@cue/core';
import { applyReview, buildCallRecord, matchUsage, stepWin } from '../adapters/core';
import { clip, type Services } from '../services/context';
import type { AppliedReview } from '../store/playbook';
import { USAGE_THRESHOLD } from './rep-turn';

const LOST: Outcome[] = ['not_interested', 'gatekeeper_blocked', 'wrong_person'];

/**
 * architecture §5.2. Reviews run one at a time (the playbook is read-modify-write). Re-reviewing a
 * call first reverts that call's previous contribution, so the result replaces rather than adds.
 */
export class ReviewPipeline {
  private chain: Promise<void> = Promise.resolve();
  private queued = new Set<string>();
  private attempts = new Map<string, number>();

  constructor(private s: Services) {}

  /** Queues a review; a call already waiting in the queue is not queued twice. */
  queue(callId: string): Promise<void> {
    if (this.queued.has(callId)) return this.chain;
    this.queued.add(callId);
    this.chain = this.chain.then(async () => {
      this.queued.delete(callId);
      this.attempts.set(callId, (this.attempts.get(callId) ?? 0) + 1);
      try {
        await this.review(callId);
      } catch (e) {
        this.s.log.error('review failed', { callId, message: e instanceof Error ? e.message : String(e) });
        try {
          this.s.store.append({ type: 'pipeline.error', callId, stage: 'review', message: clip(e instanceof Error ? e.message : String(e), 480), retryable: true });
        } catch {
          /* ignore */
        }
      }
    });
    return this.chain;
  }

  idle(): Promise<void> {
    return this.chain;
  }

  /** Ended calls with an outcome and no feedback, `autoReviewAfterMs` after they ended. */
  sweep(): void {
    const cutoff = this.s.now() - this.s.config.autoReviewAfterMs;
    for (const c of this.s.store.calls({ where: 'ended_with_outcome_unreviewed', limit: 50 }))
      if (c.endedAt !== null && c.endedAt <= cutoff && (this.attempts.get(c.id) ?? 0) < 2) void this.queue(c.id);
  }

  private async review(callId: string): Promise<void> {
    const { s } = this;
    const view = s.store.view(callId);
    if (!view || view.status === 'live') return;
    const events = s.store.list(callId);
    const record = buildCallRecord(events);
    const known = view.outcome?.outcome ?? view.feedback?.outcome ?? null;

    const context = s.playbook
      .active()
      .filter((l) => record.suggestions.some((x) => x.moment === l.moment))
      .slice(0, 30)
      .map((l) => ({ line_id: l.id, moment: l.moment, text: l.text }));
    const r = await s.models.run('review_call', { record, playbookContext: context }, { callId, budgetMs: s.config.budgets.reviewMs });

    let review: CallReview;
    let servedBy: 'mubit' | 'rules';
    if (r.ok) {
      review = fromOutput(r.output, record, view, known);
      servedBy = 'mubit';
    } else {
      review = rulesReview(record, view, known);
      servedBy = 'rules';
      if (r.code !== 'not_configured') s.store.append({ type: 'pipeline.error', callId, stage: 'review_call', message: clip(`${r.code}: ${r.message}; served by rules`, 480), retryable: r.retryable });
    }

    // The record the playbook learns from carries the review's labels.
    const labelled: CallRecord = {
      ...record,
      suggestions: record.suggestions.map((x) => {
        const u = review.linesUsed.find((l) => l.suggestionId === x.id);
        return { ...x, used: u?.used ?? false, stepWin: u?.stepWin ?? false };
      }),
    };

    // Revert this call's previous contribution, then apply the new one.
    const prev = s.playbook.applied(callId);
    const base = revert(s.playbook.all(), prev);
    const removed = prev ? prev.candidates.filter((id) => base.find((l) => l.id === id)?.status === 'candidate') : [];
    const baseLines = base.filter((l) => !removed.includes(l.id));
    const applied = applyReview(baseLines, labelled, review, { now: s.now() });

    for (const c of applied.candidates) {
      const check = await s.policy.check(c.text, 'rep', { callId });
      c.policy = { verdict: check.verdict, ...(check.rule ? { note: clip(check.rule, 300) } : {}) };
      if (check.verdict === 'violation') c.status = 'rejected';
      const i = applied.lines.findIndex((l) => l.id === c.id);
      if (i >= 0) applied.lines[i] = c;
    }

    const delta = diff(baseLines, applied.lines);
    const touched = new Set([...applied.changed, ...applied.candidates.map((c) => c.id), ...Object.keys(prev?.stats ?? {})]);
    s.playbook.remove(removed);
    s.playbook.save(applied.lines.filter((l) => touched.has(l.id)));
    s.playbook.setApplied(callId, { stats: delta, candidates: applied.candidates.map((c) => c.id) });

    s.store.append({ type: 'review.completed', callId, review, servedBy, ...(r.ok && r.requestId ? { mubitRequestId: r.requestId } : {}) });
    if (r.ok) s.telemetry.link(r.requestId, callId, 'review_call');
    s.store.append({ type: 'playbook.updated', callId, lineIds: applied.changed, candidatesAdded: applied.candidates.filter((c) => c.status === 'candidate').map((c) => c.id) });
  }
}

const zero = (): LineStats => ({ shown: 0, used: 0, stepWins: 0, booked: 0, lost: 0 });
const FIELDS = ['shown', 'used', 'stepWins', 'booked', 'lost'] as const;

function revert(lines: PlaybookLine[], prev: AppliedReview | null): PlaybookLine[] {
  if (!prev) return lines;
  return lines.map((l) => {
    const d = prev.stats[l.id];
    if (!d) return l;
    const stats = { ...l.stats };
    for (const [key, ds] of Object.entries(d)) {
      const cur = { ...(stats[key] ?? zero()) };
      for (const f of FIELDS) cur[f] = Math.max(0, cur[f] - ds[f]);
      stats[key] = cur;
    }
    return { ...l, stats };
  });
}

function diff(before: PlaybookLine[], after: PlaybookLine[]): AppliedReview['stats'] {
  const out: AppliedReview['stats'] = {};
  const prev = new Map(before.map((l) => [l.id, l]));
  for (const l of after) {
    const b = prev.get(l.id);
    if (!b) continue;
    for (const [key, st] of Object.entries(l.stats)) {
      const o = b.stats[key] ?? zero();
      const d = zero();
      let any = false;
      for (const f of FIELDS) {
        d[f] = st[f] - o[f];
        if (d[f]) any = true;
      }
      if (any) (out[l.id] ??= {})[key] = d;
    }
  }
  return out;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** Model output → stored review. Explicit rep actions and the recorded outcome win over the model. */
function fromOutput(o: ReviewCallOutput, record: CallRecord, view: CallView, known: Outcome | null): CallReview {
  const rules = rulesReview(record, view, known);
  const ids = new Set(record.suggestions.map((x) => x.id));
  const byId = new Map(o.lines_used.filter((l) => ids.has(l.suggestion_id)).map((l) => [l.suggestion_id, l]));
  return {
    summary: clip(o.summary, 1000),
    outcome: known ?? (OUTCOMES.includes(o.outcome) ? o.outcome : 'unknown'),
    linesUsed: rules.linesUsed.map((ru) => {
      const m = byId.get(ru.suggestionId);
      if (!m) return ru;
      const explicit = record.suggestions.find((x) => x.id === ru.suggestionId)?.actions.some((a) => a.action === 'used' || a.action === 'edited');
      return { suggestionId: ru.suggestionId, used: explicit || m.used, saidText: m.said_text ? clip(m.said_text, 400) : ru.saidText, similarity: clamp01(m.similarity), stepWin: m.step_win };
    }),
    candidateLines: o.candidate_lines.slice(0, 5).map((c) => ({ moment: c.moment, persona: c.persona, receptivity: c.receptivity, text: clip(c.text, 400), turnId: c.turn_id, rationale: clip(c.rationale, 400) })),
    missedMoments: o.missed_moments.slice(0, 10).map((m) => ({ turnId: m.turn_id, moment: m.moment, note: clip(m.note, 300) })),
    whatWorked: o.what_worked.slice(0, 6).map((x) => clip(x, 300)),
    whatDidnt: o.what_didnt.slice(0, 6).map((x) => clip(x, 300)),
    customerAttitude: o.customer_attitude,
    coaching: o.coaching.slice(0, 6).map((x) => clip(x, 300)),
    suggestionImpact: clamp01(o.suggestion_impact),
  };
}

/** A review with no model: usage from rep words + explicit taps, step wins by rule, the debrief's better line as a candidate. */
export function rulesReview(record: CallRecord, view: CallView, known: Outcome | null): CallReview {
  const outcome = known ?? 'unknown';
  const turns = view.turns.filter((t) => t.final);
  const linesUsed = record.suggestions.map((x) => {
    const idx = turns.findIndex((t) => t.id === x.turnId);
    const after = idx >= 0 ? turns.slice(idx + 1) : [];
    const repAfter = after.filter((t) => t.speaker === 'rep').slice(0, 2);
    let best: { text: string; score: number } | null = null;
    for (const t of repAfter) {
      const m = matchUsage(t.text, [x.say]);
      if (m && (!best || m.score > best.score)) best = { text: t.text, score: m.score };
    }
    const explicit = x.actions.some((a) => a.action === 'used' || a.action === 'edited');
    const used = explicit || (best?.score ?? 0) >= USAGE_THRESHOLD;
    const usedIdx = idx >= 0 ? idx : 0;
    return {
      suggestionId: x.id,
      used,
      saidText: best ? clip(best.text, 400) : null,
      similarity: clamp01(best?.score ?? (explicit ? 1 : 0)),
      stepWin: used ? stepWin(x.moment, turns.slice(usedIdx + 1), outcome) : false,
    };
  });
  const fb = view.feedback;
  const lastSituation = view.situation;
  const candidateLines =
    fb?.betterLine && lastSituation
      ? [{ moment: lastSituation.moment, persona: lastSituation.persona, receptivity: lastSituation.receptivity, text: clip(fb.betterLine, 400), turnId: null, rationale: 'From the rep debrief' }]
      : [];
  const used = linesUsed.filter((l) => l.used).length;
  return {
    summary: clip(rulesSummary(record.suggestions.length, used, outcome, record.policyChecks.filter((p) => p.verdict === 'violation').length), 1000),
    outcome,
    linesUsed,
    candidateLines,
    missedMoments: [],
    whatWorked: fb?.whatWorked ? [clip(fb.whatWorked, 300)] : [],
    whatDidnt: fb?.whatDidnt ? [clip(fb.whatDidnt, 300)] : [],
    customerAttitude: fb?.attitude ?? (LOST.includes(outcome) ? 'guarded' : 'neutral'),
    coaching: [],
    suggestionImpact: record.suggestions.length ? clamp01(used / record.suggestions.length) : 0,
  };
}

/** Plain sentences for the rules review, e.g. "Cue showed 3 cards and the rep used 2 of them. The call ended with a meeting booked." */
export function rulesSummary(cards: number, used: number, outcome: Outcome, violations = 0): string {
  const parts: string[] = [];
  if (cards === 0) parts.push('Cue showed no cards on this call.');
  else if (cards === 1) parts.push(used ? 'Cue showed one card and the rep used it.' : "Cue showed one card and the rep didn't use it.");
  else if (used === 0) parts.push(`Cue showed ${cards} cards and the rep used none of them.`);
  else if (used === cards) parts.push(`Cue showed ${cards} cards and the rep used all of them.`);
  else parts.push(`Cue showed ${cards} cards and the rep used ${used} of them.`);
  if (violations === 1) parts.push('One claim broke the sales policy.');
  else if (violations > 1) parts.push(`${violations} claims broke the sales policy.`);
  parts.push(outcome === 'unknown' ? "The outcome isn't known yet." : `The call ended: ${OUTCOME_LABEL[outcome].toLowerCase()}.`);
  return `${parts.join(' ')} (Reviewed by rules; the model review was unavailable.)`;
}
