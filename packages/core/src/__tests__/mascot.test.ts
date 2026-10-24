import { describe, expect, it } from 'vitest';
import { mascotFor, SUGGESTING_MS, WARNING_MS } from '../mascot';
import { reduceCall } from '../call/reduce';
import { demoEvents } from '../fixtures/demo';
import { features, log, situation, started, suggestion, T0, turn } from './helpers';

describe('mascotFor', () => {
  it('is idle without a view and offline whenever the connection is', () => {
    expect(mascotFor(null)).toBe('idle');
    expect(mascotFor(null, 'offline')).toBe('offline');
    expect(mascotFor(reduceCall(demoEvents()), 'offline')).toBe('offline');
  });

  it('walks a call through its states', () => {
    const l = log();
    started(l);
    expect(mascotFor(reduceCall(l.events))).toBe('listening');

    l.push({ type: 'turn.added', at: T0 + 1000, turn: turn('turn_1', 'prospect', 'We have a broker.', 0) });
    expect(mascotFor(reduceCall(l.events))).toBe('thinking');

    l.push({ type: 'situation.read', at: T0 + 1400, turnId: 'turn_1', situation: situation(), features, latencyMs: 400, servedBy: 'rules' });
    l.push({ type: 'suggestion.shown', at: T0 + 2000, suggestion: suggestion('sug_1', 'turn_1', T0 + 2000) });
    expect(mascotFor(reduceCall(l.events))).toBe('suggesting');
    expect(mascotFor(reduceCall(l.events), 'reconnecting')).toBe('suggesting');

    // "now" is the latest event, so the card ages as the call goes on.
    l.push({ type: 'turn.added', at: T0 + 2000 + SUGGESTING_MS, turn: turn('turn_2', 'rep', 'Makes sense.', 5000) });
    expect(mascotFor(reduceCall(l.events))).toBe('listening');

    l.push({ type: 'policy.checked', at: T0 + 10_000, check: { claim: 'covered', verdict: 'violation', rule: 'r', via: 'rules', speaker: 'rep' } });
    expect(mascotFor(reduceCall(l.events))).toBe('warning');
    l.push({ type: 'turn.added', at: T0 + 10_000 + WARNING_MS, turn: turn('turn_3', 'rep', 'Anyway.', 9000) });
    expect(mascotFor(reduceCall(l.events))).toBe('listening');

    l.push({ type: 'call.ended', at: T0 + 30_000, durationMs: 30_000 });
    expect(mascotFor(reduceCall(l.events))).toBe('idle');

    l.push({ type: 'feedback.submitted', at: T0 + 40_000, feedback: { outcome: 'follow_up', helpful: [], unhelpful: [], submittedAt: T0 + 40_000 } });
    expect(mascotFor(reduceCall(l.events))).toBe('learning');

    l.push({ type: 'outcome.recorded', at: T0 + 41_000, outcome: { outcome: 'meeting_booked', source: 'hubspot', raw: {}, at: T0 + 41_000 } });
    expect(mascotFor(reduceCall(l.events))).toBe('celebrating');
  });

  it('only warns for a violation, and warning beats celebrating', () => {
    const l = log();
    started(l);
    l.push({ type: 'policy.checked', check: { claim: 'x', verdict: 'supported', rule: 'r', via: 'rules', speaker: 'rep' } });
    expect(mascotFor(reduceCall(l.events))).toBe('listening');
    l.push({ type: 'outcome.recorded', outcome: { outcome: 'meeting_booked', source: 'rep', raw: {}, at: T0 } });
    l.push({ type: 'policy.checked', check: { claim: 'x', verdict: 'violation', rule: 'r', via: 'rules', speaker: 'rep' } });
    expect(mascotFor(reduceCall(l.events))).toBe('warning');
  });

  it('celebrates the booked demo call', () => {
    expect(mascotFor(reduceCall(demoEvents()))).toBe('celebrating');
  });
});
