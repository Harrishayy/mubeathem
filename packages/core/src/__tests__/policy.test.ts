import { describe, expect, it } from 'vitest';
import { CORGI_POLICY, findRiskyClaims } from '../policy/rules';
import { SEED_PLAYBOOK } from '../playbook/seed';

describe('findRiskyClaims', () => {
  const risky = [
    ["Yeah, that'd definitely be covered.", 0],
    ["You're covered for that, no question.", 0],
    ["Don't worry, we'd cover that.", 0],
    ['It would probably be about $2k a year.', 1],
    ["You're looking at two grand a year, tops.", 1],
    ['The premium would be around $1,500 for you.', 1],
    ['I can guarantee the approval.', 2],
    ['We guarantee you will save money.', 2],
    ['There are no exclusions on this one.', 3],
    ['It covers everything.', 3],
    ["We're the cheapest out there.", 4],
    ['We can beat any quote you have.', 4],
  ] as const;
  it.each(risky)('flags %s', (text, rule) => {
    const hits = findRiskyClaims(text);
    expect(hits.map((h) => h.rule)).toContain(CORGI_POLICY[rule]);
    expect(hits[0]!.rephrase.length).toBeGreaterThan(10);
    expect(text).toContain(hits[0]!.claim.replace(/[.?!]$/, '').slice(0, 10));
  });

  const safe = [
    "That's exactly what the quote call will confirm.",
    'Would our AI product even be covered?',
    "I can't guarantee anything before underwriting.",
    'They raised $14M in March.',
    'Is that covered under your current policy?',
    "We'll get you a real number on the quote call.",
    'Easiest is fifteen minutes with our team, they will quote you live.',
    "I won't promise it's covered until underwriting has looked.",
  ];
  it.each(safe)('does not flag %s', (text) => {
    expect(findRiskyClaims(text)).toEqual([]);
  });

  it('passes every seed line', () => {
    for (const l of SEED_PLAYBOOK) expect(findRiskyClaims(l.text), l.id).toEqual([]);
  });

  it('returns one hit per rule and the sentence that carries it', () => {
    const hits = findRiskyClaims('Great company. It is definitely covered and the premium is $900 a month. Guaranteed.');
    expect(hits.map((h) => h.rule)).toEqual([CORGI_POLICY[0], CORGI_POLICY[1], CORGI_POLICY[2]]);
    expect(hits[0]!.claim).toBe('It is definitely covered and the premium is $900 a month.');
  });
});

describe('findRiskyClaims reassurances', () => {
  it('flags a promise behind "don\'t worry" or "no worries"', () => {
    expect(findRiskyClaims("Don't worry you'd definitely be covered")).toHaveLength(1);
    expect(findRiskyClaims("No worries, it's covered")).toHaveLength(1);
  });
  it('still treats real negations as safe', () => {
    expect(findRiskyClaims("I can't promise it's covered")).toHaveLength(0);
  });
});
