import { describe, expect, it } from 'vitest';
import type { PlaybookLine } from '../schema/domain';
import { PlaybookLine as PlaybookLineZ } from '../schema/domain';
import type { CallRecord, CallReview } from '../schema/tasks';
import { applyReview } from '../playbook/apply';
import { SEED_PLAYBOOK } from '../playbook/seed';
import { buildCallRecord } from '../call/record';
import { demoEvents } from '../fixtures/demo';
import { idTime } from '../ids';

const NOW = Date.UTC(2026, 9, 22);

function line(id: string, text: string, stats: PlaybookLine['stats'] = {}): PlaybookLine {
  return { id, moment: 'objection_broker', personas: [], receptivity: [], text, style: 'straight', products: [], status: 'active', origin: 'seed', createdAt: 0, stats };
}

function record(outcome: CallRecord['outcome'], suggestions: Partial<CallRecord['suggestions'][number]>[]): CallRecord {
  return {
    callId: 'call_x',
    source: 'cue',
    startedAt: 0,
    durationMs: 1000,
    prospect: { name: '', title: '', company: '', facts: {} },
    rep: { id: 'rep_1', name: 'Alex', tenureDays: null },
    transcript: [],
    situations: [],
    suggestions: suggestions.map((s, i) => ({
      id: `sug_${i}`,
      turnId: `turn_${i}`,
      lineId: 'line_a',
      moment: 'objection_broker',
      situationKey: 'ceo.cool.objection_broker',
      say: '',
      kind: 'line',
      shownAtMs: 0,
      latencyMs: 0,
      servedBy: 'rules',
      actions: [],
      used: null,
      stepWin: null,
      mubitRequestIds: [],
      ...s,
    })),
    policyChecks: [],
    receptivityTrend: [],
    outcome,
    feedback: null,
    trellus: null,
  };
}

function review(over: Partial<CallReview> = {}): CallReview {
  return { summary: '', outcome: 'meeting_booked', linesUsed: [], candidateLines: [], missedMoments: [], whatWorked: [], whatDidnt: [], customerAttitude: 'neutral', coaching: [], suggestionImpact: 0, ...over };
}

describe('applyReview', () => {
  const lines = [line('line_a', 'Makes sense, most founders do. When did they last re-quote you after a raise?'), line('line_b', 'Something else entirely.')];

  it('counts shown, used, step wins, booked under the situation key and *', () => {
    const rec = record({ outcome: 'meeting_booked', source: 'rep', raw: {} }, [{}, { id: 'sug_1' }, { id: 'sug_2', lineId: 'line_b', situationKey: 'ceo.warm.objection_broker' }]);
    const rev = review({
      linesUsed: [
        { suggestionId: 'sug_0', used: true, saidText: 'x', similarity: 0.9, stepWin: false },
        { suggestionId: 'sug_1', used: false, saidText: null, similarity: 0, stepWin: false },
        { suggestionId: 'sug_2', used: true, saidText: 'y', similarity: 0.8, stepWin: true },
      ],
    });
    const out = applyReview(lines, rec, rev, { now: NOW });
    const a = out.lines.find((l) => l.id === 'line_a')!;
    // Booked credits the used line's step even though its own step didn't win.
    expect(a.stats['ceo.cool.objection_broker']).toEqual({ shown: 2, used: 1, stepWins: 1, booked: 1, lost: 0 });
    expect(a.stats['*']).toEqual({ shown: 2, used: 1, stepWins: 1, booked: 1, lost: 0 });
    expect(out.lines.find((l) => l.id === 'line_b')!.stats['ceo.warm.objection_broker']).toEqual({ shown: 1, used: 1, stepWins: 1, booked: 1, lost: 0 });
    expect(out.changed).toEqual(['line_a', 'line_b']);
  });

  it('counts lost calls only for lines that were used', () => {
    const rec = record({ outcome: 'not_interested', source: 'trellus', raw: {} }, [{ used: true, stepWin: true }, { id: 'sug_1', used: false }]);
    const out = applyReview(lines, rec, review({ outcome: 'not_interested' }), { now: NOW });
    expect(out.lines[0]!.stats['*']).toEqual({ shown: 2, used: 1, stepWins: 1, booked: 0, lost: 1 });
  });

  it('adds onto existing stats and never mutates its inputs', () => {
    const seeded = [line('line_a', 'x', { '*': { shown: 10, used: 8, stepWins: 4, booked: 1, lost: 2 } })];
    const frozen = structuredClone(seeded);
    const out = applyReview(seeded, record({ outcome: 'follow_up', source: 'rep', raw: {} }, [{ used: true, stepWin: true }]), review({ outcome: 'follow_up' }), { now: NOW });
    expect(out.lines[0]!.stats['*']).toEqual({ shown: 11, used: 9, stepWins: 5, booked: 1, lost: 2 });
    expect(seeded).toEqual(frozen);
  });

  it('skips compliance cards and lines not in the playbook', () => {
    const rec = record(null, [{ kind: 'compliance' }, { id: 'sug_1', lineId: 'line_unknown' }]);
    const out = applyReview(lines, rec, review({ outcome: 'unknown' }), { now: NOW });
    expect(out.changed).toEqual([]);
    expect(out.lines).toEqual(lines);
  });

  it('adds new candidates, dedupes near-copies and drops risky ones', () => {
    const cand = (text: string) => ({ moment: 'objection_broker' as const, persona: 'ceo' as const, receptivity: 'cool' as const, text, turnId: 'turn_9', rationale: 'r' });
    const rev = review({
      candidateLines: [
        cand('Makes sense, most founders do. When did they last re-quote you after the raise?'), // near-copy of line_a
        cand('Totally, keep them. Did anyone check your cover kept up when the team doubled?'),
        cand('Totally, keep them! Did anyone check your cover kept up when the team doubled?'), // dupe of the one above
        cand("Switch to us and you're definitely covered."),
        cand('   '),
      ],
    });
    const out = applyReview(lines, record(null, []), rev, { now: NOW });
    expect(out.candidates).toHaveLength(1);
    const c = out.candidates[0]!;
    expect(PlaybookLineZ.safeParse(c).success).toBe(true);
    expect(c).toMatchObject({ status: 'candidate', origin: 'rep', style: 'question', personas: ['ceo'], receptivity: ['cool'], createdAt: NOW, minedFrom: { callId: 'call_x', turnId: 'turn_9', repId: 'rep_1' } });
    expect(idTime(c.id)).toBe(NOW);
    expect(out.lines).toHaveLength(3);
    // Same inputs, same id.
    expect(applyReview(lines, record(null, []), rev, { now: NOW }).candidates[0]!.id).toBe(c.id);
  });

  it('folds the demo call into the seed playbook', () => {
    const events = demoEvents();
    const rev = events.find((e) => e.type === 'review.completed')!;
    if (rev.type !== 'review.completed') throw new Error('no review');
    const out = applyReview(SEED_PLAYBOOK, buildCallRecord(events), rev.review, { now: NOW });
    const joke = out.lines.find((l) => l.id === 'line_seed_wtr_joke')!;
    const before = SEED_PLAYBOOK.find((l) => l.id === 'line_seed_wtr_joke')!;
    expect(joke.stats['ceo.cold.whats_this_regarding']!.stepWins).toBe(before.stats['ceo.cold.whats_this_regarding']!.stepWins + 1);
    expect(out.candidates).toHaveLength(1);
    expect(out.lines.every((l) => PlaybookLineZ.safeParse(l).success)).toBe(true);
  });
});
