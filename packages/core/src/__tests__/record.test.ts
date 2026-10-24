import { describe, expect, it } from 'vitest';
import { buildCallRecord } from '../call/record';
import { CallRecord } from '../schema/tasks';
import { demoEvents, demoScript } from '../fixtures/demo';
import { features, log, situation, started, suggestion, T0, turn } from './helpers';

describe('buildCallRecord', () => {
  it('builds a schema-valid record from the demo log', () => {
    for (const variant of ['cold', 'warm'] as const) {
      const record = buildCallRecord(demoEvents({ variant }));
      expect(CallRecord.safeParse(record).success).toBe(true);
      expect(record.transcript).toHaveLength(demoScript(variant).length);
      expect(record.outcome?.outcome).toBe('meeting_booked');
      expect(record.feedback?.rating).toBe(5);
      expect(record.policyChecks).toHaveLength(1);
      expect(record.policyChecks[0]!.verdict).toBe('violation');
      expect(record.durationMs).toBeGreaterThan(30_000);
    }
  });

  it('carries every card with its actions and the review verdict', () => {
    const record = buildCallRecord(demoEvents());
    const joke = record.suggestions.find((s) => s.lineId === 'line_seed_wtr_joke')!;
    expect(joke.situationKey).toBe('ceo.cold.whats_this_regarding');
    expect(joke.actions.map((a) => a.action)).toEqual(['used', 'thumbs_up']);
    expect(joke.used).toBe(true);
    expect(joke.stepWin).toBe(true);
    const compliance = record.suggestions.find((s) => s.kind === 'compliance')!;
    expect(compliance.say).toBe("That's exactly what the quote call will confirm.");
    expect(record.situations.length).toBe(demoScript().filter((l) => l.speaker === 'prospect').length);
    expect(record.situations.map((s) => s.tMs)).toEqual([...record.situations.map((s) => s.tMs)].sort((a, b) => a - b));
  });

  it('keeps every final turn, drops interim ones, and nulls missing labels', () => {
    const l = log();
    started(l);
    for (let i = 0; i < 230; i++) l.push({ type: 'turn.added', turn: turn(`turn_${i}`, i % 2 ? 'prospect' : 'rep', `t${i}`, i * 1000) });
    l.push({ type: 'turn.added', turn: turn('turn_x', 'prospect', 'half', 999_000, { final: false }) });
    l.push({ type: 'situation.read', turnId: 'turn_1', situation: situation(), features, latencyMs: 200, servedBy: 'rules' });
    l.push({ type: 'suggestion.shown', suggestion: suggestion('sug_1', 'turn_1', T0 + 3000) });
    const record = buildCallRecord(l.events);
    expect(CallRecord.safeParse(record).success).toBe(true);
    expect(record.transcript).toHaveLength(230);
    expect(record.suggestions[0]).toMatchObject({ used: null, stepWin: null, actions: [] });
    expect(record.outcome).toBeNull();
    expect(record.feedback).toBeNull();
    expect(record.trellus).toBeNull();
    expect(record.rep.tenureDays).toBeNull();
  });

  it('copies the Trellus session id and disposition', () => {
    const l = log();
    l.push({
      type: 'call.started',
      at: T0,
      source: 'trellus',
      trellusSessionId: 'sess_42',
      prospect: { name: 'A', title: 'CEO', company: 'B', facts: {} },
      rep: { id: 'rep_1', name: 'Alex' },
    });
    l.push({ type: 'outcome.recorded', outcome: { outcome: 'follow_up', source: 'trellus', raw: { disposition: 'Follow Up' }, at: T0 } });
    expect(buildCallRecord(l.events).trellus).toEqual({ sessionId: 'sess_42', disposition: { disposition: 'Follow Up' } });
  });
});
