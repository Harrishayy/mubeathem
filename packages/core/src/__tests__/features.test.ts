import { describe, expect, it } from 'vitest';
import { computeFeatures, detectSignals } from '../signals/features';
import { TurnFeatures } from '../schema/domain';
import type { TurnFeatures as TurnFeaturesT } from '../schema/domain';
import { features, turn } from './helpers';

describe('computeFeatures', () => {
  const turns = [
    turn('t1', 'rep', 'Hi, this is Alex from Corgi.', 0, { durMs: 2000 }),
    turn('t2', 'prospect', 'Hi.', 2600, { durMs: 400 }),
    turn('t3', 'rep', 'Saw the raise, congrats. Quick one about your insurance', 3500, { durMs: 3000 }),
    turn('t4', 'prospect', 'What is this regarding?', 6200, { durMs: 1200 }),
  ];

  it('counts words, share, latency, questions and elapsed time', () => {
    const f = computeFeatures(turns, 3);
    expect(TurnFeatures.safeParse(f).success).toBe(true);
    expect(f).toMatchObject({ turnIndex: 3, prospectWords: 4, repWords: 9, questionsAsked: 1, interrupted: true, elapsedMs: 7400 });
    expect(f.replyLatencyMs).toBeUndefined();
    expect(f.prospectShare).toBeCloseTo(5 / 20, 5);
    expect(computeFeatures(turns, 1).replyLatencyMs).toBe(600);
  });

  it('flags a prospect cutting in on a trailing rep turn', () => {
    const t = [turn('a', 'rep', 'So the reason I called is—', 0), turn('b', 'prospect', 'Not interested.', 1000)];
    expect(computeFeatures(t, 1).interrupted).toBe(true);
  });

  it('measures the trend in prospect share across windows', () => {
    const quiet = Array.from({ length: 6 }, (_, i) => turn(`q${i}`, i % 2 ? 'prospect' : 'rep', i % 2 ? 'ok' : 'a long rep turn with many many words', i * 1000));
    const open = Array.from({ length: 6 }, (_, i) => turn(`o${i}`, i % 2 ? 'prospect' : 'rep', i % 2 ? 'a long prospect turn with many many words' : 'ok', 6000 + i * 1000));
    const f = computeFeatures([...quiet, ...open], 11);
    expect(f.shareTrend).toBeGreaterThan(0.5);
  });

  it('subtracts an absolute call start', () => {
    const t = [turn('a', 'prospect', 'Hello?', 1_000_000_500)];
    expect(computeFeatures(t, 0, { callStartedAt: 1_000_000_000 }).elapsedMs).toBe(500);
  });

  it('is safe on empty or out-of-range input', () => {
    expect(computeFeatures([], 0)).toMatchObject({ prospectWords: 0, elapsedMs: 0 });
    expect(computeFeatures(turns, 99).prospectWords).toBe(4);
  });
});

describe('detectSignals', () => {
  const cases: [string, string[], Partial<TurnFeaturesT>?][] = [
    ['Yeah.', ['one_word_answer']],
    ['Who gave you this number?', ['asked_question', 'hostile_phrase']],
    ['Oh sure, happy to chat!', ['friendly_phrase']],
    ["I'm about to jump on a call, make it quick.", ['time_pressure']],
    ['How much would that cost us?', ['asked_question', 'asked_price']],
    ['Haha, fair enough.', ['humour']],
    ['You would want to talk to our CFO.', ['referral_offered']],
    ['Thursday works, send me the invite.', ['agreed_next_step']],
    ['Mm, go on.', ['long_pause'], { replyLatencyMs: 4000 }],
  ];
  it.each(cases)('%s', (text, expected, over) => {
    const got = detectSignals(text, { ...features, ...over });
    for (const s of expected) expect(got).toContain(s);
  });

  it("doesn't read a gatekeeper's 'she's in a meeting' as time pressure", () => {
    expect(detectSignals("She's in a meeting right now.", features)).not.toContain('time_pressure');
  });

  it('does not call "no thanks" friendly', () => {
    expect(detectSignals('No thanks.', features)).not.toContain('friendly_phrase');
  });
});
