import { describe, expect, it } from 'vitest';
import { CallEvent } from '../schema/events';
import { DEMO_PROSPECT, DEMO_REP, DEMO_SCRIPT, demoEvents } from '../fixtures/demo';
import { Prospect, Rep } from '../schema/domain';

const cards = (variant: 'warm' | 'cold') => demoEvents({ variant }).flatMap((e) => (e.type === 'suggestion.shown' ? [e.suggestion] : []));

describe('demo fixture', () => {
  it('has a valid prospect, rep and both variants of the script', () => {
    expect(Prospect.safeParse(DEMO_PROSPECT).success).toBe(true);
    expect(Rep.safeParse(DEMO_REP).success).toBe(true);
    expect(DEMO_SCRIPT.some((l) => l.variant === 'warm')).toBe(true);
    expect(DEMO_SCRIPT.some((l) => l.variant === 'cold')).toBe(true);
  });

  it('emits schema-valid events with increasing seq and non-decreasing time', () => {
    for (const variant of ['warm', 'cold'] as const) {
      const events = demoEvents({ variant });
      events.forEach((e, i) => {
        expect(CallEvent.safeParse(e).success, e.type).toBe(true);
        expect(e.seq).toBe(i + 1);
        if (i > 0) expect(e.at).toBeGreaterThanOrEqual(events[i - 1]!.at);
      });
      expect(events[0]!.type).toBe('call.started');
      expect(events[events.length - 1]!.type).toBe('playbook.updated');
    }
  });

  it('is identical on every run', () => {
    expect(demoEvents()).toEqual(demoEvents());
  });

  it('tells the demo story', () => {
    const cold = cards('cold');
    const warm = cards('warm');
    const wtr = (cs: typeof cold) => cs.find((c) => c.situation.moment === 'whats_this_regarding')!;
    expect(wtr(cold).lineId).toBe('line_seed_wtr_joke');
    expect(wtr(cold).evidence.text).toBe('2.1× the straight answer with cold CEOs · 41 calls');
    expect(wtr(warm).lineId).not.toBe('line_seed_wtr_joke');
    for (const cs of [cold, warm]) {
      expect(cs[0]!.situation.moment).toBe('gatekeeper');
      expect(cs.map((c) => c.situation.moment)).toEqual(expect.arrayContaining(['opener', 'objection_broker', 'compliance', 'buying_signal', 'close']));
      expect(cs.find((c) => c.kind === 'compliance')?.compliance?.verdict).toBe('violation');
      expect(cs.every((c) => c.servedBy === 'rules')).toBe(true);
    }
  });

  it('ends with the playbook updated and a mined candidate', () => {
    const last = demoEvents().at(-1)!;
    if (last.type !== 'playbook.updated') throw new Error('expected playbook.updated');
    expect(last.lineIds).toContain('line_seed_wtr_joke');
    expect(last.candidatesAdded).toHaveLength(1);
  });
});
