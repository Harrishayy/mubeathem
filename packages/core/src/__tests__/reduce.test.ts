import { describe, expect, it } from 'vitest';
import { applyEvent, emptyView, reduceCall, VIEW_TURN_CAP } from '../call/reduce';
import { CallView } from '../schema/api';
import { demoEvents } from '../fixtures/demo';
import { CALL, T0, features, log, situation, started, suggestion, turn } from './helpers';

describe('reduceCall', () => {
  it('reduces the demo log to a schema-valid, reviewed view', () => {
    const view = reduceCall(demoEvents());
    expect(CallView.safeParse(view).success).toBe(true);
    expect(view.status).toBe('reviewed');
    expect(view.outcome?.outcome).toBe('meeting_booked');
    expect(view.current).toBeNull();
    expect(view.pending).toBe(false);
    expect(view.flags).toHaveLength(1);
    expect(view.history.length).toBeGreaterThan(5);
    expect(view.turns.every((t) => t.final)).toBe(true);
  });

  it('is idempotent on replay and tolerant of order', () => {
    const events = demoEvents();
    const once = reduceCall(events);
    expect(reduceCall([...events, ...events])).toEqual(once);
    expect(reduceCall([...events].reverse())).toEqual(once);
    let v = once;
    for (const e of events) v = applyEvent(v, e);
    expect(v).toEqual(once);
  });

  it('never mutates the view it is given', () => {
    const l = log();
    started(l);
    const before = reduceCall(l.events);
    const snapshot = structuredClone(before);
    applyEvent(before, { type: 'turn.added', callId: CALL, at: T0 + 5, seq: 2, turn: turn('turn_1', 'prospect', 'Hello?', 0) });
    expect(before).toEqual(snapshot);
  });

  it('ignores events for another call', () => {
    const v = emptyView(CALL);
    const next = applyEvent(v, { type: 'brief.ready', callId: 'call_other', at: T0, seq: 1, brief: { summary: '', hooks: [], opener: '', personaGuess: 'ceo', servedBy: 'rules' } });
    expect(next).toBe(v);
  });
});

describe('turns', () => {
  it('replaces an interim turn with its final and ignores a late interim', () => {
    const l = log();
    started(l);
    l.push({ type: 'turn.added', turn: turn('turn_1', 'prospect', 'We already', 1000, { final: false }) });
    l.push({ type: 'turn.added', turn: turn('turn_1', 'prospect', 'We already have a broker.', 1000) });
    l.push({ type: 'turn.added', turn: turn('turn_1', 'prospect', 'We already have', 1000, { final: false }) });
    const v = reduceCall(l.events);
    expect(v.turns).toHaveLength(1);
    expect(v.turns[0]!.text).toBe('We already have a broker.');
    expect(v.turns[0]!.final).toBe(true);
  });

  it('keeps turns in time order when one arrives late', () => {
    const l = log();
    started(l);
    l.push({ type: 'turn.added', turn: turn('turn_2', 'prospect', 'second', 2000) });
    l.push({ type: 'turn.added', turn: turn('turn_1', 'rep', 'first', 1000) });
    expect(reduceCall(l.events).turns.map((t) => t.id)).toEqual(['turn_1', 'turn_2']);
  });

  it(`caps the view at ${VIEW_TURN_CAP} turns, keeping the newest`, () => {
    const l = log();
    started(l);
    for (let i = 0; i < VIEW_TURN_CAP + 30; i++) l.push({ type: 'turn.added', turn: turn(`turn_${i}`, i % 2 ? 'prospect' : 'rep', `t${i}`, i * 1000) });
    const v = reduceCall(l.events);
    expect(v.turns).toHaveLength(VIEW_TURN_CAP);
    expect(v.turns[v.turns.length - 1]!.id).toBe(`turn_${VIEW_TURN_CAP + 29}`);
    expect(reduceCall(l.events, { maxTurns: Infinity }).turns).toHaveLength(VIEW_TURN_CAP + 30);
  });
});

describe('pending', () => {
  it('is true from a final prospect turn until that turn is read', () => {
    const l = log();
    started(l);
    l.push({ type: 'turn.added', turn: turn('turn_1', 'prospect', 'Hi', 0, { final: false }) });
    expect(reduceCall(l.events).pending).toBe(false);
    l.push({ type: 'turn.added', turn: turn('turn_1', 'prospect', 'Hi, this is Maya.', 0) });
    expect(reduceCall(l.events).pending).toBe(true);
    l.push({ type: 'turn.added', turn: turn('turn_2', 'prospect', 'Who is this?', 2000) });
    // A read for the superseded turn doesn't clear it; the newer turn is still being worked on.
    l.push({ type: 'situation.read', turnId: 'turn_1', situation: situation(), features, latencyMs: 300, servedBy: 'rules' });
    expect(reduceCall(l.events).pending).toBe(true);
    l.push({ type: 'suggestion.skipped', turnId: 'turn_2', reason: 'quiet' });
    expect(reduceCall(l.events).pending).toBe(false);
  });

  it('clears on a pipeline error and records it', () => {
    const l = log();
    started(l);
    l.push({ type: 'turn.added', turn: turn('turn_1', 'prospect', 'Hello?', 0) });
    l.push({ type: 'pipeline.error', stage: 'read_moment', message: 'timeout', retryable: true });
    const v = reduceCall(l.events);
    expect(v.pending).toBe(false);
    expect(v.lastError).toEqual({ stage: 'read_moment', message: 'timeout' });
  });

  it('is not set by rep turns', () => {
    const l = log();
    started(l);
    l.push({ type: 'turn.added', turn: turn('turn_1', 'rep', 'Hi there', 0) });
    expect(reduceCall(l.events).pending).toBe(false);
  });
});

describe('current card', () => {
  function withCard() {
    const l = log();
    started(l);
    l.push({ type: 'turn.added', turn: turn('turn_1', 'prospect', 'We have a broker.', 0) });
    l.push({ type: 'situation.read', turnId: 'turn_1', situation: situation(), features, latencyMs: 300, servedBy: 'rules' });
    l.push({ type: 'suggestion.shown', suggestion: suggestion('sug_1', 'turn_1', T0 + 4000) });
    return l;
  }

  it('stays on screen through skips and actions other than dismiss', () => {
    const l = withCard();
    l.push({ type: 'turn.added', turn: turn('turn_2', 'prospect', 'Mm.', 5000) });
    l.push({ type: 'suggestion.skipped', turnId: 'turn_2', reason: 'quiet' });
    l.push({ type: 'suggestion.action', suggestionId: 'sug_1', action: 'used' });
    const v = reduceCall(l.events);
    expect(v.current?.id).toBe('sug_1');
    expect(v.history[0]!.action).toBe('used');
  });

  it('is replaced by a new card', () => {
    const l = withCard();
    l.push({ type: 'suggestion.shown', suggestion: suggestion('sug_2', 'turn_1', T0 + 9000) });
    const v = reduceCall(l.events);
    expect(v.current?.id).toBe('sug_2');
    expect(v.history.map((h) => h.suggestion.id)).toEqual(['sug_1', 'sug_2']);
  });

  it('goes when dismissed', () => {
    const l = withCard();
    l.push({ type: 'suggestion.action', suggestionId: 'sug_1', action: 'dismissed' });
    expect(reduceCall(l.events).current).toBeNull();
  });

  it('goes when the call ends', () => {
    const l = withCard();
    l.push({ type: 'call.ended', durationMs: 60_000 });
    const v = reduceCall(l.events);
    expect(v.current).toBeNull();
    expect(v.status).toBe('ended');
    expect(v.endedAt).not.toBeNull();
  });

  it('records the receptivity trend at the turn offset', () => {
    const l = withCard();
    expect(reduceCall(l.events).receptivityTrend).toEqual([{ tMs: 0, score: 0.2 }]);
  });
});

describe('outcome and status', () => {
  it('prefers the more trusted outcome source', () => {
    const l = log();
    started(l);
    l.push({ type: 'outcome.recorded', outcome: { outcome: 'follow_up', source: 'trellus', raw: { disposition: 'Follow up' }, at: T0 } });
    l.push({ type: 'outcome.recorded', outcome: { outcome: 'not_interested', source: 'rep', raw: {}, at: T0 } });
    expect(reduceCall(l.events).outcome?.source).toBe('trellus');
    l.push({ type: 'outcome.recorded', outcome: { outcome: 'meeting_booked', source: 'hubspot', raw: {}, at: T0 } });
    expect(reduceCall(l.events).outcome?.outcome).toBe('meeting_booked');
  });

  it('moves live → ended → reviewing → reviewed', () => {
    const l = log();
    started(l);
    expect(reduceCall(l.events).status).toBe('live');
    l.push({ type: 'call.ended', durationMs: 1000 });
    expect(reduceCall(l.events).status).toBe('ended');
    l.push({ type: 'feedback.submitted', feedback: { outcome: 'meeting_booked', helpful: [], unhelpful: [], submittedAt: T0 } });
    const reviewing = reduceCall(l.events);
    expect(reviewing.status).toBe('reviewing');
    expect(reviewing.outcome).toMatchObject({ outcome: 'meeting_booked', source: 'rep' });
    l.push({
      type: 'review.completed',
      servedBy: 'rules',
      review: { summary: '', outcome: 'meeting_booked', linesUsed: [], candidateLines: [], missedMoments: [], whatWorked: [], whatDidnt: [], customerAttitude: 'neutral', coaching: [], suggestionImpact: 0 },
    });
    expect(reduceCall(l.events).status).toBe('reviewed');
  });

  it('stamps flags with the event time', () => {
    const l = log();
    started(l);
    l.push({ type: 'policy.checked', at: T0 + 777, check: { claim: 'x', verdict: 'violation', rule: 'r', via: 'rules', speaker: 'rep' } });
    expect(reduceCall(l.events).flags[0]!.at).toBe(T0 + 777);
  });
});
