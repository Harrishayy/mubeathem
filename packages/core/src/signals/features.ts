import type { ToneSignal } from '../taxonomy';
import { TONE_SIGNALS } from '../taxonomy';
import type { Turn, TurnFeatures } from '../schema/domain';
import { clamp, isQuestion, normaliseText, wordCount } from '../text';

const SHARE_WINDOW = 6;
/** A reply this slow after the rep stops reads as hesitation. */
export const LONG_PAUSE_MS = 2500;

function share(turns: Turn[]): number | null {
  let p = 0;
  let total = 0;
  for (const t of turns) {
    const w = wordCount(t.text);
    total += w;
    if (t.speaker === 'prospect') p += w;
  }
  return total === 0 ? null : p / total;
}

/** A rep turn that trails off ("so the reason I—") was cut short. */
const TRAILING_CUT = /(-|—|–|\.\.\.|…)\s*$/;

/**
 * Cheap transcript features for the turn at `index` (normally a final prospect turn).
 * `prospectWords` counts that turn; `repWords` counts the rep's turns since the prospect last spoke.
 * Only final turns are considered. `callStartedAt` is subtracted when turn offsets are absolute epoch ms.
 */
export function computeFeatures(turns: Turn[], index: number, opts: { callStartedAt?: number } = {}): TurnFeatures {
  const finals = turns.map((t, i) => ({ t, i })).filter((x) => x.t.final !== false || x.i === index);
  const pos = Math.max(0, finals.findIndex((x) => x.i === Math.min(index, turns.length - 1)));
  const list = finals.map((x) => x.t);
  const cur = list[pos];

  if (!cur) {
    return { turnIndex: Math.max(0, index), prospectWords: 0, repWords: 0, prospectShare: 0, shareTrend: 0, interrupted: false, questionsAsked: 0, elapsedMs: 0 };
  }

  const prospectWords = cur.speaker === 'prospect' ? wordCount(cur.text) : 0;
  let repWords = 0;
  for (let i = pos - 1; i >= 0 && list[i]!.speaker === 'rep'; i--) repWords += wordCount(list[i]!.text);

  const recent = list.slice(Math.max(0, pos + 1 - SHARE_WINDOW), pos + 1);
  const before = list.slice(Math.max(0, pos + 1 - 2 * SHARE_WINDOW), Math.max(0, pos + 1 - SHARE_WINDOW));
  const nowShare = share(recent) ?? 0;
  const prevShare = share(before);
  const shareTrend = prevShare === null ? 0 : clamp(nowShare - prevShare, -1, 1);

  const prev = list[pos - 1];
  let replyLatencyMs: number | undefined;
  let interrupted = false;
  if (prev && prev.speaker !== cur.speaker) {
    if (prev.durMs !== undefined) {
      const gap = cur.tMs - (prev.tMs + prev.durMs);
      if (gap < 0) interrupted = true;
      else replyLatencyMs = Math.round(gap);
    }
    if (prev.speaker === 'rep' && TRAILING_CUT.test(prev.text)) interrupted = true;
  }

  let questionsAsked = 0;
  for (let i = 0; i <= pos; i++) {
    const t = list[i]!;
    if (t.speaker === 'prospect' && isQuestion(t.text)) questionsAsked++;
  }

  const startedAt = opts.callStartedAt;
  const offset = startedAt !== undefined && cur.tMs >= startedAt ? cur.tMs - startedAt : cur.tMs;
  const elapsedMs = Math.max(0, Math.round(offset + (cur.durMs ?? 0)));

  const out: TurnFeatures = {
    turnIndex: Math.max(0, index),
    prospectWords,
    repWords,
    prospectShare: clamp(nowShare, 0, 1),
    shareTrend,
    interrupted,
    questionsAsked,
    elapsedMs,
  };
  if (replyLatencyMs !== undefined) out.replyLatencyMs = replyLatencyMs;
  return out;
}

const PATTERNS: Partial<Record<ToneSignal, RegExp>> = {
  asked_price:
    /\b(how much|price|pricing|priced|cost|costs|premium|premiums|quote|quoted|expensive|budget|ballpark|per month|a year)\b/,
  hostile_phrase:
    /\b(who gave you (this|my) number|how did you get (this|my) number|take me off|stop calling|don'?t call|do not call|remove me|leave me alone|waste of (my )?time|scam|not interested|go away|hang(ing)? up)\b/,
  friendly_phrase:
    /\b(oh,? (sure|hi|hey|yeah)|sure thing|happy to|of course|no worries|sounds (good|great)|good to (hear|meet)|thanks|thank you|appreciate|love to|nice|absolutely|great question|good question|glad you)\b/,
  time_pressure:
    /\b(busy|slammed|swamped|(i'?m|i am|we'?re|about to go|heading) (in|into) a meeting|(i'?m|i am) on another call|jump(ing)? on a call|between meetings|running late|got to go|gotta go|have to run|no time|make it quick|be quick|quickly|one minute|a minute|two minutes|hop off|bad time)\b/,
  humour: /\b(ha(ha)+|ha|lol|that'?s funny|you'?re funny|\(laughs?\)|\[laughs?\]|cheeky)\b/,
  referral_offered:
    /\b(talk to|speak (to|with)|you'?d want|you('ll| will) want|(she|he|they) handles?|reach out to|loop in|cc|(my|our) (cfo|co-?founder|head of|finance|ops|operations|coo))\b/,
  second_voice:
    /\b(jumping in|just joined|also on (the line|here)|i'?m (also )?on the line|(this is|it'?s) \w+,? (the |our )?(cfo|coo|finance|head of))\b/,
  agreed_next_step:
    /\b((monday|tuesday|wednesday|thursday|friday)( works| is good| afternoon| morning)|works for me|that works|let'?s do it|book it|send (me |over )?(the |an? )?(invite|calendar)|put it in|i'?m free|happy to (take|do) (a|the) (call|meeting)|set (it|something) up|sounds good,? let'?s)\b/,
};

/** Word-level tone signals in one prospect turn, given its features. Never labels the person. */
export function detectSignals(text: string, f: TurnFeatures): ToneSignal[] {
  const t = normaliseText(text);
  const found = new Set<ToneSignal>();
  if (wordCount(text) <= 2) found.add('one_word_answer');
  if (f.interrupted) found.add('cut_rep_off');
  if ((f.replyLatencyMs ?? 0) >= LONG_PAUSE_MS || /^(\.\.\.|…)/.test(t)) found.add('long_pause');
  if (isQuestion(text)) found.add('asked_question');
  for (const [signal, re] of Object.entries(PATTERNS) as [ToneSignal, RegExp][]) {
    if (re.test(t)) found.add(signal);
  }
  // "not great" / "no thanks" are not friendly.
  if (found.has('friendly_phrase') && /\b(not (great|nice)|no thanks?( you)?)\b/.test(t)) found.delete('friendly_phrase');
  return TONE_SIGNALS.filter((s) => found.has(s));
}
