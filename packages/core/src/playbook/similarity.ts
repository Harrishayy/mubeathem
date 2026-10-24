import { tokens } from '../text';

/** A rep's words count as "using" a shown line at or above this score. */
export const USAGE_THRESHOLD = 0.6;

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function bigramDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function tokenDice(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let overlap = 0;
  for (const t of A) if (B.has(t)) overlap++;
  return (2 * overlap) / (A.size + B.size);
}

/** How alike two lines are, 0..1: the mean of token-set Dice and character-bigram Dice over normalised text. */
export function lineSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return ta.length === tb.length ? 1 : 0;
  const ja = ta.join(' ');
  const jb = tb.join(' ');
  if (ja === jb) return 1;
  return (tokenDice(ta, tb) + bigramDice(ja, jb)) / 2;
}

/** Share of the shown line's words the rep said, for when the line is buried in a longer turn. */
function coverage(said: string[], shown: string[]): number {
  const S = new Set(said);
  const L = new Set(shown);
  if (L.size === 0) return 0;
  let hit = 0;
  for (const t of L) if (S.has(t)) hit++;
  return hit / L.size;
}

/**
 * Which shown line (if any) the rep actually said. Scores each by the better of whole-line similarity
 * and word coverage (discounted slightly, since coverage ignores order), and returns the best one at
 * or above `USAGE_THRESHOLD`.
 */
export function matchUsage(said: string, shown: string[]): { index: number; score: number } | null {
  const ts = tokens(said);
  if (ts.length === 0) return null;
  let best: { index: number; score: number } | null = null;
  shown.forEach((line, index) => {
    const tl = tokens(line);
    if (tl.length === 0) return;
    const score = Math.max(lineSimilarity(said, line), tl.length >= 4 ? coverage(ts, tl) * 0.9 : 0);
    if (!best || score > best.score) best = { index, score };
  });
  const b = best as { index: number; score: number } | null;
  return b && b.score >= USAGE_THRESHOLD ? { index: b.index, score: Math.round(b.score * 1000) / 1000 } : null;
}
