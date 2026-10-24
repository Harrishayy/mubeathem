import { describe, expect, it } from 'vitest';
import type { Moment } from '../taxonomy';
import { Situation } from '../schema/domain';
import type { ReadMomentInput, ReadMomentOutput } from '../schema/tasks';
import { DEMO_PROSPECT, demoScript } from '../fixtures/demo';
import { computeFeatures } from '../signals/features';
import { personaFromTitle, rulesReadMoment, toSituation } from '../signals/rules';
import { features, turn } from './helpers';
import type { Turn } from '../schema/domain';

const crm = { title: DEMO_PROSPECT.title, company: DEMO_PROSPECT.company, facts: DEMO_PROSPECT.facts };

/** Reads every turn of a script in order, chaining `previous` like the pipeline does. */
function readScript(lines: { speaker: Turn['speaker']; text: string }[]) {
  const turns: Turn[] = [];
  let previous: ReadMomentInput['previous'] = null;
  return lines.map((l, i) => {
    turns.push(turn(`t${i}`, l.speaker, l.text, i * 4000, { durMs: 2500 }));
    const out = rulesReadMoment({ crm, window: turns.slice(-8).map((t) => ({ speaker: t.speaker, text: t.text, tMs: t.tMs })), features: computeFeatures(turns, i), previous });
    if (l.speaker === 'prospect') previous = { persona: out.persona, receptivity: out.receptivity, moment: out.moment };
    return out;
  });
}

describe('rulesReadMoment on the demo script', () => {
  for (const variant of ['cold', 'warm'] as const) {
    it(`hits ≥ 85% of expected moments (${variant})`, () => {
      const script = demoScript(variant);
      const reads = readScript(script);
      const expected = script.map((l, i) => ({ l, r: reads[i]! })).filter((x) => x.l.expect);
      const hits = expected.filter((x) => x.r.moment === x.l.expect).length;
      expect(hits / expected.length).toBeGreaterThanOrEqual(0.85);
      for (const x of expected) if (x.l.receptivity) expect(x.l.receptivity).toContain(x.r.receptivity);
    });
  }

  it('reads the gatekeeper, then the CEO when she picks up', () => {
    const reads = readScript(demoScript('cold'));
    expect(reads[1]!.persona).toBe('gatekeeper');
    expect(reads[3]!.should_suggest).toBe(false); // being put through: stay quiet
    expect(reads[4]!.persona).toBe('ceo');
  });

  it('reads the two "what\'s this regarding?" variants differently', () => {
    const warm = readScript(demoScript('warm'));
    const cold = readScript(demoScript('cold'));
    const w = warm.find((r) => r.moment === 'whats_this_regarding')!;
    const c = cold.find((r) => r.moment === 'whats_this_regarding')!;
    expect(w.receptivity).toBe('warm');
    expect(c.receptivity).toBe('cold');
    expect(w.receptivity_score).toBeGreaterThan(c.receptivity_score);
  });
});

describe('rulesReadMoment on single turns', () => {
  const one = (text: string, title = 'CEO', previous: ReadMomentInput['previous'] = null) =>
    rulesReadMoment({ crm: { title, company: 'X', facts: {} }, window: [{ speaker: 'prospect', text, tMs: 0 }], features, previous });

  const cases: [string, Moment][] = [
    ["Just send me an email and I'll take a look.", 'brush_off_email'],
    ["I'm slammed right now, can't really talk.", 'brush_off_busy'],
    ['Not interested, thanks.', 'objection_not_interested'],
    ["We're too expensive already, we can't afford more insurance.", 'objection_price'],
    ['Maybe next quarter, after the round closes.', 'objection_timing'],
    ['We work with a broker for all of that.', 'objection_broker'],
    ['How does the quote work?', 'buying_signal'],
    ["You've reached the voicemail of Maya Chen, please leave a message after the tone.", 'voicemail'],
    ['Who is this?', 'whats_this_regarding'],
    ['Thursday afternoon works for me.', 'close'],
    ['Hello?', 'opener'],
  ];
  it.each(cases)('%s → %s', (text, moment) => {
    expect(one(text).moment).toBe(moment);
  });

  it('lets the transcript override the CRM persona', () => {
    expect(one("I'm one of the engineers here, what's this about?").persona).toBe('engineer');
    expect(one('Can I take a message?').persona).toBe('gatekeeper');
    expect(one('Hello?', 'VP Engineering').persona).toBe('engineer');
  });

  it('reads hostile wording as cold and stays quiet in voicemail', () => {
    const hostile = one('Who gave you this number? Take me off your list.');
    expect(hostile.receptivity).toBe('cold');
    expect(one('Please leave a message after the tone.').should_suggest).toBe(false);
  });

  it('reads a rep claim as compliance', () => {
    const out = rulesReadMoment({ crm, window: [{ speaker: 'rep', text: "Don't worry, that's definitely covered.", tMs: 0 }], features, previous: null });
    expect(out.moment).toBe('compliance');
    expect(out.should_suggest).toBe(true);
  });

  it('is deterministic', () => {
    expect(one('We already have a broker.')).toEqual(one('We already have a broker.'));
  });
});

describe('personaFromTitle', () => {
  it.each([
    ['Co-founder & CEO', 'ceo'],
    ['CFO', 'cfo'],
    ['Head of Finance', 'cfo'],
    ['Staff Software Engineer', 'engineer'],
    ['VP Sales', 'other_exec'],
    ['Executive Assistant to the CEO', 'gatekeeper'],
    ['', 'unknown'],
  ])('%s → %s', (title, persona) => expect(personaFromTitle(title)).toBe(persona));
});

describe('toSituation', () => {
  it('clamps, camelCases and drops unknown signals', () => {
    const raw = {
      persona: 'ceo',
      persona_confidence: 1.4,
      receptivity: 'cold',
      receptivity_score: -3,
      moment: 'small_talk',
      moment_confidence: -1,
      tone: { engagement: 2, warmth: -1, patience: 0.5, interest: Number.NaN },
      signals: ['humour', 'made_up', 'humour'],
      should_suggest: true,
      rationale: 'x'.repeat(500),
    } as unknown as ReadMomentOutput;
    const s = toSituation(raw);
    expect(Situation.safeParse(s).success).toBe(true);
    expect(s).toMatchObject({ personaConfidence: 1, receptivityScore: -1, momentConfidence: 0, signals: ['humour'] });
    expect(s.shouldSuggest).toBe(false); // small talk never suggests
    expect(s.rationale).toHaveLength(300);
  });

  it('round-trips a rules read', () => {
    const out = rulesReadMoment({ crm, window: [{ speaker: 'prospect', text: 'We have a broker.', tMs: 0 }], features, previous: null });
    expect(Situation.safeParse(toSituation(out)).success).toBe(true);
  });
});
