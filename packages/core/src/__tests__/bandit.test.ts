import { describe, expect, it } from 'vitest';
import type { LineStats, PlaybookLine } from '../schema/domain';
import { BACKOFF_SHOWS, evidenceFor, rankLines, sampleBeta, YOUNG_SHOWS } from '../playbook/bandit';
import { SEED_PLAYBOOK } from '../playbook/seed';
import { seededRng } from '../text';

const KEY = 'ceo.cold.whats_this_regarding';
const st = (shown: number, used: number, stepWins: number, booked = 0, lost = 0): LineStats => ({ shown, used, stepWins, booked, lost });

function mk(id: string, stats: Record<string, LineStats>, over: Partial<PlaybookLine> = {}): PlaybookLine {
  return {
    id,
    moment: 'whats_this_regarding',
    personas: [],
    receptivity: [],
    text: id,
    style: 'straight',
    products: [],
    status: 'active',
    origin: 'seed',
    createdAt: 0,
    stats,
    ...over,
  };
}

const winner = mk('line_win', { [KEY]: st(40, 40, 24), '*': st(60, 60, 30) }, { style: 'self-aware' });
const loser = mk('line_lose', { [KEY]: st(40, 40, 10), '*': st(60, 60, 20) });
const middling = mk('line_mid', { [KEY]: st(30, 30, 12), '*': st(40, 40, 15) }, { style: 'question' });
const young = mk('line_young', { '*': st(3, 3, 1) }, { style: 'proof' });
const s = { persona: 'ceo', receptivity: 'cold', moment: 'whats_this_regarding' } as const;

describe('sampleBeta', () => {
  it('has the right mean and stays in (0, 1)', () => {
    const rng = seededRng(7);
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      const x = sampleBeta(5, 15, rng);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 5000).toBeCloseTo(0.25, 1);
  });

  it('terminates on a degenerate generator', () => {
    expect(Number.isFinite(sampleBeta(2, 3, () => 0))).toBe(true);
    expect(Number.isFinite(sampleBeta(2, 3, () => 0.999999))).toBe(true);
  });
});

describe('rankLines', () => {
  it('prefers the winning line over 1000 seeded draws but still explores', () => {
    const rng = seededRng(2026);
    const top: Record<string, number> = {};
    let explored = 0;
    for (let i = 0; i < 1000; i++) {
      const ranked = rankLines([loser, middling, winner, young], s, { k: 3, rng });
      top[ranked[0]!.line.id] = (top[ranked[0]!.line.id] ?? 0) + 1;
      if (ranked.some((r) => r.line.id === 'line_young')) explored++;
    }
    expect(top.line_win).toBeGreaterThan(850);
    expect(top.line_lose ?? 0).toBeLessThan(top.line_win! / 10);
    expect((top.line_mid ?? 0) + (top.line_lose ?? 0)).toBeGreaterThan(0); // Thompson still samples the others
    expect(explored).toBe(1000); // the exploration slot always goes to the young line
  });

  it('puts the young line in the last slot and labels it', () => {
    const ranked = rankLines([loser, middling, winner, young], s, { k: 3, rng: seededRng(1) });
    expect(ranked).toHaveLength(3);
    expect(ranked[2]!.line.id).toBe('line_young');
    expect(ranked[2]!.evidence).toMatchObject({ basis: 'explore', text: 'New line, getting a fair trial' });
  });

  it('can turn the exploration slot off', () => {
    const ranked = rankLines([loser, middling, winner, young], s, { k: 3, rng: seededRng(1), exploreSlot: false });
    expect(ranked.map((r) => r.line.id)).not.toContain('line_young');
  });

  it('lets young lines fill in when there are not enough proven ones', () => {
    const ranked = rankLines([winner, young], s, { k: 3, rng: seededRng(1) });
    expect(ranked.map((r) => r.line.id)).toEqual(['line_win', 'line_young']);
  });

  it(`backs off to * stats below ${BACKOFF_SHOWS} shows in the situation`, () => {
    const thin = mk('line_thin', { [KEY]: st(2, 2, 0), '*': st(80, 80, 60) });
    const ranked = rankLines([thin], s, { k: 1, rng: seededRng(3) });
    expect(ranked[0]!.stats).toEqual(st(80, 80, 60));
    expect(ranked[0]!.sampledWinRate).toBeGreaterThan(0.5);
  });

  it('is deterministic for a seeded rng', () => {
    const a = rankLines(SEED_PLAYBOOK, s, { rng: seededRng(9) });
    const b = rankLines(SEED_PLAYBOOK, s, { rng: seededRng(9) });
    expect(a).toEqual(b);
  });

  it('filters by moment, status and the line’s personas / receptivity', () => {
    const retired = mk('line_retired', { '*': st(100, 100, 90) }, { status: 'retired' });
    const engineersOnly = mk('line_eng', { '*': st(100, 100, 90) }, { personas: ['engineer'] });
    const otherMoment = mk('line_other', { '*': st(100, 100, 90) }, { moment: 'opener' });
    const ids = rankLines([retired, engineersOnly, otherMoment, loser], s, { k: 5, rng: seededRng(1) }).map((r) => r.line.id);
    expect(ids).toEqual(['line_lose']);
    // With nothing matching the persona filter, any line for the moment will do.
    expect(rankLines([engineersOnly], s, { k: 1, rng: seededRng(1) })[0]!.line.id).toBe('line_eng');
  });

  it('returns nothing for k = 0 or an empty pool', () => {
    expect(rankLines(SEED_PLAYBOOK, s, { k: 0 })).toEqual([]);
    expect(rankLines([], s)).toEqual([]);
  });

  it('ranks the self-aware line first for cold CEOs and the straight answer for warm ones', () => {
    const rng = seededRng(42);
    let coldJoke = 0;
    let warmStraight = 0;
    for (let i = 0; i < 500; i++) {
      if (rankLines(SEED_PLAYBOOK, s, { rng })[0]!.line.id === 'line_seed_wtr_joke') coldJoke++;
      if (rankLines(SEED_PLAYBOOK, { ...s, receptivity: 'warm' }, { rng })[0]!.line.id === 'line_seed_wtr_straight') warmStraight++;
    }
    expect(coldJoke).toBeGreaterThan(450);
    expect(warmStraight).toBeGreaterThan(300);
  });
});

describe('evidenceFor', () => {
  it('compares a non-straight line with the straight answer', () => {
    const joke = SEED_PLAYBOOK.find((l) => l.id === 'line_seed_wtr_joke')!;
    expect(evidenceFor(joke, KEY, SEED_PLAYBOOK)).toMatchObject({ text: '2.1× the straight answer with cold CEOs · 41 calls', calls: 41, basis: 'bandit' });
  });

  it('writes the step win sentence for the moment’s job', () => {
    const gk = SEED_PLAYBOOK.find((l) => l.id === 'line_seed_gk_board')!;
    expect(evidenceFor(gk, 'gatekeeper.neutral.gatekeeper').text).toBe('Got through 14 of 38 times here');
    const close = SEED_PLAYBOOK.find((l) => l.id === 'line_seed_cl_book')!;
    expect(evidenceFor(close, 'ceo.warm.close').text).toBe('Booked 21 of 28 times here');
    expect(evidenceFor(close, 'cfo.cold.close').text).toBe('Booked 21 of 28 times across the team');
  });

  it(`calls a line under ${YOUNG_SHOWS} shows new`, () => {
    expect(evidenceFor(young, KEY)).toMatchObject({ text: 'New line, getting a fair trial', basis: 'explore', calls: 3 });
    expect(evidenceFor(mk('line_blank', {}), KEY)).toMatchObject({ calls: 0, basis: 'explore' });
  });

  it('falls back to the plain sentence when the lift is small', () => {
    const near = mk('line_near', { [KEY]: st(40, 40, 11), '*': st(40, 40, 11) }, { style: 'question' });
    expect(evidenceFor(near, KEY, [loser]).text).toBe('Earned the next 30 seconds 11 of 40 times here');
  });
});
