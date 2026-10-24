import { normaliseText } from '../text';

/**
 * Corgi's sales policy as sent to check_claim. Illustrative (context.md §8); one rule per line so a
 * verdict can name the rule it hit.
 */
export const CORGI_POLICY: string[] = [
  'Never promise that a specific claim, loss or situation will be covered before underwriting has reviewed it.',
  'Never quote, estimate or imply a premium figure before a quote has been generated.',
  'Never guarantee approval, coverage, pricing or savings.',
  'Never say a policy has no exclusions or covers everything.',
  'Never claim to be the cheapest or to beat any competitor on price.',
  'Never disparage the prospect’s current broker or carrier.',
];

export interface RiskyClaim {
  /** The sentence that carries the claim, as said. */
  claim: string;
  /** The CORGI_POLICY rule it would break. */
  rule: string;
  /** A safe line the rep can say instead. */
  rephrase: string;
}

interface ClaimRule {
  re: RegExp;
  rule: string;
  rephrase: string;
}

const NUMBER_WORDS = '(?:\\d[\\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|fifty|a few|a couple of)';
const PERIOD = '(?:a|an|per|/|each|every)\\s*(?:year|yr|annum|month|mo|quarter)';

const RULES: ClaimRule[] = [
  {
    re: /\b(definitely|absolutely|certainly|totally|100%|for sure|fully) (be )?covered\b|\b(that'?s|that is|that would be|that'?d be|that will be|that'?ll be|it'?s|it would be|it'?d be|you'?d be|you would be|you'?ll be|you will be|you'?re|you are) (definitely |absolutely |totally |certainly |fully |100% )?covered( for)?\b|\bwe('d| would| will|'ll) (definitely |absolutely )?cover (that|it|this)\b/,
    rule: CORGI_POLICY[0]!,
    rephrase: "That's exactly what the quote call will confirm.",
  },
  {
    re: new RegExp(
      `\\$\\s?\\d[\\d,.]*\\s?(?:k|m|grand|thousand|hundred)?\\s*${PERIOD}|\\b${NUMBER_WORDS}\\s?(?:k|grand|thousand|hundred)( dollars| bucks)?\\s*${PERIOD}|\\b(premium|cost|price|run you|pay|be about|be around|ballpark)\\b[^.?!]{0,30}\\$\\s?\\d`,
    ),
    rule: CORGI_POLICY[1]!,
    rephrase: "I can't put a number on it before underwriting, but the quote call gives you a real one.",
  },
  {
    re: /\bguarantee(d|s)?\b/,
    rule: CORGI_POLICY[2]!,
    rephrase: "I won't promise anything before underwriting, but the quote call will tell you exactly where you stand.",
  },
  {
    re: /\bno exclusions\b|\bnothing('s| is)? excluded\b|\bcovers? (absolutely )?(everything|anything)\b/,
    rule: CORGI_POLICY[3]!,
    rephrase: 'Every policy has terms, and the quote call walks you through exactly what yours would include.',
  },
  {
    re: /\bcheapest\b|\blowest (price|premium|rate)s?\b|\bbeat (any|every|your) (quote|price|broker|carrier)\b|\balways cheaper\b/,
    rule: CORGI_POLICY[4]!,
    rephrase: "Plenty of founders find we're competitive, and the quote call will show you a real number side by side.",
  },
];

/** A negation right before the claim, at most two words back ("can't promise it's covered"); punctuation breaks it ("don't worry, it's covered"). */
/** Reassurances that read like negations but strengthen the promise ("don't worry you're covered"). */
const REASSURANCE = /\b(don'?t|do not|never) (worry|fret|stress)\b|\bno (worries|problem|doubt)\b/g;
const NEGATION = /\b(can'?t|cannot|won'?t|not|never|no|don'?t|wouldn'?t|couldn'?t|isn'?t)\b(\s+[\w']+){0,2}\s*$/;

function sentenceAround(original: string, start: number, end: number): string {
  const before = original.slice(0, start);
  const from = Math.max(before.lastIndexOf('.'), before.lastIndexOf('?'), before.lastIndexOf('!')) + 1;
  const rest = original.slice(end);
  const stop = rest.search(/[.?!]/);
  const to = stop === -1 ? original.length : end + stop + 1;
  return original.slice(from, to).trim().slice(0, 400);
}

/**
 * Fast pre-filter for claims a rep (or a written line) shouldn't make: coverage promises, premium
 * figures, guarantees, "no exclusions", "cheapest". A hit goes to check_claim; no hit means no call.
 * Negated phrasing ("I can't guarantee…") is not flagged.
 */
export function findRiskyClaims(text: string): RiskyClaim[] {
  // Same length as `text`, so match offsets map straight back to the original wording.
  const lower = text.toLowerCase().replace(/[‘’ʼ]/g, "'");
  const out: RiskyClaim[] = [];
  for (const r of RULES) {
    const re = new RegExp(r.re.source, 'g');
    for (const m of lower.matchAll(re)) {
      const start = m.index ?? 0;
      const before = lower.slice(Math.max(0, start - 24), start).replace(REASSURANCE, ' ');
      if (NEGATION.test(before)) continue;
      out.push({ claim: sentenceAround(text, start, start + m[0].length), rule: r.rule, rephrase: r.rephrase });
      break;
    }
  }
  return out;
}

/** True when `findRiskyClaims` finds anything. */
export function hasRiskyClaim(text: string): boolean {
  return findRiskyClaims(normaliseText(text)).length > 0;
}
