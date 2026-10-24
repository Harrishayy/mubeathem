/**
 * Endpointing on interim transcripts: does a partial look like the prospect has finished their
 * sentence? Used to start the live pipeline before the transcriber's final arrives (the final lands
 * 300–1000 ms after the speaker stops). Pure, so the server and clients agree and it is unit tested.
 */

/** Words a sentence rarely ends on: a partial ending here is mid-thought. */
export const CONTINUATION_WORDS: ReadonlySet<string> = new Set([
  'and', 'but', 'or', 'so', 'because', 'cause', 'if', 'then', 'which', 'who', 'when', 'where', 'while',
  'the', 'a', 'an', 'to', 'of', 'with', 'from', 'by', 'at',
  'um', 'uh', 'er', 'erm', 'i', 'we', 'our', 'my', 'your', 'their', 'is', 'are', 'was', 'were', 'be', 'just', 'kind', 'sort',
]);

export interface EndpointOptions {
  /** Silence (no new words) after which an unpunctuated partial counts as finished. Default 350. */
  pauseMs?: number;
}

export type EndpointReason = 'empty' | 'punctuation' | 'pause' | 'trailing' | 'waiting';

export interface EndpointGuess {
  complete: boolean;
  reason: EndpointReason;
  /** When not complete: how much longer (ms of unchanged text) before it would be. Null = never on its own. */
  recheckInMs: number | null;
}

/**
 * Guess whether `text` (an interim) is a finished utterance, given how long it has been unchanged.
 * - Ends in `?` or `!`, or `.` after a word a sentence can end on (Deepgram punctuates interims): complete now.
 * - Ends mid-thought (comma, dash, ellipsis, or a continuation word like "and", "the", "um"):
 *   only after twice the pause.
 * - Otherwise (Web Speech interims carry no punctuation): complete after `pauseMs` unchanged.
 */
export function endpointGuess(text: string, unchangedMs: number, opts: EndpointOptions = {}): EndpointGuess {
  const pause = opts.pauseMs ?? 350;
  const t = text.trim();
  if (!t) return { complete: false, reason: 'empty', recheckInMs: null };
  const trailing = /(,|;|:|-|–|—|\.\.\.|…)$/.test(t);
  const lastWord = (t.toLowerCase().replace(/[^a-z'\s]/g, ' ').trim().split(/\s+/).pop() ?? '').replace(/'.*$/, '');
  // A question mark ends a question whatever the last word ("what's this about?"); a full stop after
  // "and"/"the" is the transcriber guessing.
  if (!trailing && (/[?!]["')\]]?$/.test(t) || (/\.["')\]]?$/.test(t) && !CONTINUATION_WORDS.has(lastWord)))) return { complete: true, reason: 'punctuation', recheckInMs: null };
  if (trailing || CONTINUATION_WORDS.has(lastWord)) {
    const wait = pause * 2;
    return unchangedMs >= wait ? { complete: true, reason: 'pause', recheckInMs: null } : { complete: false, reason: 'trailing', recheckInMs: wait - unchangedMs };
  }
  return unchangedMs >= pause ? { complete: true, reason: 'pause', recheckInMs: null } : { complete: false, reason: 'waiting', recheckInMs: pause - unchangedMs };
}

/** Same utterance text, ignoring case, punctuation and spacing (an interim vs its final). */
export function sameUtterance(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return n(a) === n(b);
}
