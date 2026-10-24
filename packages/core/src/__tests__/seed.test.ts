import { describe, expect, it } from 'vitest';
import { MOMENTS, MOMENT_META } from '../taxonomy';
import { PlaybookLine, UpNext } from '../schema/domain';
import { SEED_PLAYBOOK, upNextFor } from '../playbook/seed';
import { wordCount } from '../text';

describe('SEED_PLAYBOOK', () => {
  it('parses and has unique line ids', () => {
    for (const l of SEED_PLAYBOOK) expect(PlaybookLine.safeParse(l).success, l.id).toBe(true);
    expect(new Set(SEED_PLAYBOOK.map((l) => l.id)).size).toBe(SEED_PLAYBOOK.length);
    expect(SEED_PLAYBOOK.every((l) => l.id.startsWith('line_'))).toBe(true);
  });

  it('has 3–5 active lines for every moment that suggests, in varied styles', () => {
    for (const m of MOMENTS) {
      const lines = SEED_PLAYBOOK.filter((l) => l.moment === m && l.status === 'active');
      if (!MOMENT_META[m].suggests) {
        expect(lines, m).toHaveLength(0);
        continue;
      }
      expect(lines.length, m).toBeGreaterThanOrEqual(3);
      expect(lines.length, m).toBeLessThanOrEqual(5);
      if (m !== 'compliance') expect(new Set(lines.map((l) => l.style)).size, m).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps every line to one breath and free of names', () => {
    for (const l of SEED_PLAYBOOK) {
      expect(wordCount(l.text), l.text).toBeLessThanOrEqual(26);
      expect(l.text).not.toMatch(/Maya|Alex|Lumen/);
    }
  });

  it('keeps * totals consistent with the per-situation rows', () => {
    for (const l of SEED_PLAYBOOK) {
      const total = l.stats['*']!;
      const rows = Object.entries(l.stats).filter(([k]) => k !== '*').map(([, v]) => v);
      expect(total.shown).toBe(rows.reduce((n, r) => n + r.shown, 0));
      for (const r of rows) {
        expect(r.used).toBeLessThanOrEqual(r.shown);
        expect(r.stepWins).toBeLessThanOrEqual(r.used);
        expect(r.booked).toBeLessThanOrEqual(r.used);
      }
    }
  });

  it('has context.md card copy verbatim where given', () => {
    const texts = SEED_PLAYBOOK.map((l) => l.text);
    expect(texts).toContain("Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.");
    expect(texts).toContain('Makes sense, most founders do. When did they last re-quote you after a raise?');
    expect(texts).toContain("Happy to. So it's actually useful, what's the one thing you'd want it to answer?");
    expect(texts).toContain("Easiest is fifteen minutes with our team, they'll quote you live. Thursday or Friday?");
    expect(texts).toContain("That's exactly what the quote call will confirm.");
  });
});

describe('upNextFor', () => {
  it('gives two schema-valid moves for suggesting moments and none for quiet ones', () => {
    for (const m of MOMENTS) {
      const next = upNextFor(m);
      if (MOMENT_META[m].suggests) {
        expect(next, m).toHaveLength(2);
        for (const u of next) expect(UpNext.safeParse(u).success).toBe(true);
      } else expect(next).toEqual([]);
    }
  });
});
