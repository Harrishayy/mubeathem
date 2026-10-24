/** Small text helpers shared by the signal, policy and similarity modules. */

/** Lowercases, folds curly quotes, and collapses whitespace. Keeps punctuation. */
export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word tokens: lowercase, apostrophes dropped ("don't" → "dont"), punctuation removed. */
export function tokens(text: string): string[] {
  return normaliseText(text)
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Number of words in a string. */
export function wordCount(text: string): number {
  return tokens(text).length;
}

const QUESTION_START =
  /^(what|whats|who|whos|how|hows|why|when|where|which|is|are|was|were|do|does|did|can|could|would|will|should|have|has|any|may)\b/;

/** True when the text asks something, by punctuation or (for unpunctuated transcripts) by its first word. */
export function isQuestion(text: string): boolean {
  if (text.includes('?')) return true;
  const sentences = normaliseText(text).replace(/'/g, '').split(/[.!]+/).map((s) => s.trim()).filter(Boolean);
  return sentences.some((s) => QUESTION_START.test(s));
}

/** Clamps a number into [lo, hi]; NaN becomes lo. */
export function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

/** 32-bit FNV-1a hash of a string, for deterministic seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seeded uniform [0, 1) generator (mulberry32). Same seed, same sequence. */
export function seededRng(seed: number | string): () => number {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
