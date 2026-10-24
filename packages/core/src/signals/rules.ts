import type { Moment, Persona, ToneSignal } from '../taxonomy';
import { MOMENT_META, RECEPTIVITY_SCORE, TONE_SIGNALS, receptivityFromScore } from '../taxonomy';
import type { Situation } from '../schema/domain';
import type { ReadMomentInput, ReadMomentOutput } from '../schema/tasks';
import { findRiskyClaims } from '../policy/rules';
import { clamp, normaliseText, wordCount } from '../text';
import { detectSignals } from './features';

/* ───────────── persona ───────────── */

/** Maps a CRM job title onto a persona. */
export function personaFromTitle(title: string): Persona {
  const t = normaliseText(title);
  if (!t) return 'unknown';
  if (/\b(assistant|receptionist|office manager|front desk|ea|executive assistant|admin)\b/.test(t)) return 'gatekeeper';
  if (/\b(ceo|chief executive|founder|co-?founder|owner|president)\b/.test(t)) return 'ceo';
  if (/\b(cfo|chief financial|finance|controller|treasurer|accounting)\b/.test(t)) return 'cfo';
  if (/\b(cto|engineer|engineering|developer|architect|ml|swe)\b/.test(t)) return 'engineer';
  if (/\b(chief|coo|cro|cmo|cpo|vp|vice president|head of|director|general manager|gm|partner)\b/.test(t)) return 'other_exec';
  return 'unknown';
}

/** Lines only a gatekeeper says: the decision-maker in the third person, messages, transfers. */
const GATEKEEPER_SPEECH =
  /\b(((she|he)('s| is)|\w+'s|\w+ is) (in a meeting|not (available|in (today|the office|yet))|out (today|of the office)|away|on (a|another) call|tied up|with a client)|(she|he) (isn'?t|is not) (available|in)|can i take a message|take a message|who'?s calling|who is calling|may i ask who|can i ask who|(i'?m|i am) (her|his|the) (assistant|ea)|front desk|office of|(let me|i'?ll) (see if|check if|transfer|put you through|connect you)|put you through|transfer you|(she|he)'?ll call you back|what is (this|it) (in )?regard(ing)? to|(she|he) handles)\b/;
/** Decision-maker naming themselves or picking up after a transfer. */
const SELF_INTRO = /^(hi|hello|hey|yes|yeah)?[,.!\s]*(this is|it'?s|you'?ve got|speaking|\w+ (here|speaking))\b|\bspeaking\b/;

function readPersona(text: string, input: ReadMomentInput, signals: ToneSignal[]): { persona: Persona; confidence: number; why: string | null } {
  const crm = personaFromTitle(input.crm.title);
  const prev = input.previous?.persona ?? null;

  if (/\b(i'?m|i am) (one of the |an? |the )?(engineers?|developers?|on the (engineering|eng|dev) team|cto)\b/.test(text))
    return { persona: 'engineer', confidence: 0.9, why: 'says they are an engineer' };
  if (/\b(i'?m|i am|this is) (the )?(cfo|head of finance|finance lead|in finance)\b/.test(text) || (signals.includes('second_voice') && signals.includes('asked_price')))
    return { persona: 'cfo', confidence: 0.85, why: 'finance voice on the line' };
  if (GATEKEEPER_SPEECH.test(text)) return { persona: 'gatekeeper', confidence: 0.9, why: 'speaks for the decision-maker' };
  if (prev === 'gatekeeper' && SELF_INTRO.test(text)) {
    const p = crm === 'gatekeeper' || crm === 'unknown' ? 'other_exec' : crm;
    return { persona: p, confidence: 0.75, why: 'decision-maker picked up' };
  }
  if (prev && prev !== 'unknown') return { persona: prev, confidence: 0.7, why: null };
  if (crm !== 'unknown') return { persona: crm, confidence: 0.65, why: null };
  return { persona: 'unknown', confidence: 0.3, why: null };
}

/* ───────────── moment ───────────── */

interface MomentRule {
  moment: Moment;
  re: RegExp;
  confidence: number;
  cue: string;
}

/** Checked in order; the first match wins. Specific objections before generic ones. */
const MOMENT_RULES: MomentRule[] = [
  {
    moment: 'voicemail',
    re: /\b(leave (a|your) message|after the (tone|beep)|at the (tone|beep)|voicemail|not available to take your call|mailbox)\b/,
    confidence: 0.9,
    cue: 'voicemail greeting',
  },
  {
    moment: 'close',
    re: /\b((monday|tuesday|wednesday|thursday|friday)( works| is good| is fine| afternoon| morning|'?s good)|works for me|that works|let'?s do it|book it|send (me |over )?(the |an? )?(invite|calendar)|put (it|something) in|i'?m free|happy to (take|do|hop on) (a|the) (call|meeting)|set (it|something) up|let'?s (set|book|schedule|find a time)|what times? (do you|works|are you)|when (are you|is your team) free)\b/,
    confidence: 0.85,
    cue: 'agreed to a time',
  },
  {
    moment: 'wrap_up',
    re: /\b(talk (then|soon|later)|see you then|speak (then|soon)|bye|goodbye|have a good (one|day|week)|cheers,? bye)\b/,
    confidence: 0.75,
    cue: 'signing off',
  },
  {
    moment: 'objection_price',
    re: /\b(too expensive|can'?t afford|no budget|not in (the|our) budget|(costs?|price is|pricing is) too|cheaper (elsewhere|option)|already paying (too much|enough)|insurance is (a waste|expensive))\b/,
    confidence: 0.8,
    cue: 'pushing back on price',
  },
  {
    moment: 'buying_signal',
    re: /\b(how much|what (would|does|will) (it|that|this|something like that) (cost|run|be)|pricing|ballpark|what('s| is) the (premium|price|cost)|how (does|would) (that|it|this|the quote) work|what would you need( from us)?|could you (quote|send a quote)|what do you (cover|need)|how (fast|quickly|long)|would (our|the|my) [\w\s]{1,30} (be )?covered|do you (cover|do))\b/,
    confidence: 0.8,
    cue: 'asking how it works or what it costs',
  },
  {
    moment: 'brush_off_email',
    re: /\b(send (me |us |over )?(an? |some )?(email|info|information|details|something|deck)|email me|shoot me (an|a) (email|note)|drop me (an|a) (email|line|note)|put it in (an|a) email|just email)\b/,
    confidence: 0.85,
    cue: 'asked for an email',
  },
  {
    moment: 'objection_broker',
    re: /\b((have|got|use|work with|went with) (a |an |our )?(broker|agent|carrier|provider)|(our|my) (broker|agent|carrier)|already (have|got) (insurance|coverage|d&o|a policy|that covered)|(we'?re|we are) (already )?(covered|insured|all set on (that|insurance)))\b/,
    confidence: 0.85,
    cue: 'already has a broker',
  },
  {
    moment: 'objection_timing',
    re: /\b(not (right )?now|next (quarter|year|month)|maybe later|(after|end of|until) (the |our )?(year|quarter|raise|round|renewal)|revisit|circle back|not a priority|bad timing|timing isn'?t|call me (back )?in (a|\d+|two|three|six) (weeks?|months?)|renewal (isn'?t|is not) (until|for))\b/,
    confidence: 0.8,
    cue: 'not the right time',
  },
  {
    moment: 'brush_off_busy',
    re: /\b((i'?m|i am|we'?re) (really |super |pretty )?(busy|slammed|swamped|in the middle of|about to (jump|hop|go))|bad time|not a good time|can'?t (really )?talk|(got|have) (a|one|two) minutes?|running (into|to) a meeting|in a meeting|call (me )?back later|make it quick|be quick)\b/,
    confidence: 0.8,
    cue: 'short on time',
  },
  {
    moment: 'objection_not_interested',
    re: /\b(not interested|no thanks|no thank you|(we )?don'?t need (it|that|insurance|anything)|we'?re (good|fine)|pass on (this|that)|take me off|stop calling|don'?t call)\b/,
    confidence: 0.8,
    cue: 'not interested',
  },
  {
    moment: 'whats_this_regarding',
    re: /\b(what('?s| is) (this|it|the call) (regarding|about|in regard(s)? to|for)|what('?s| is) this (call )?about|what (do you|can i do for you|are you) (want|selling|calling about)|who is this|who'?s this|why are you calling|what can i do for you)\b/,
    confidence: 0.85,
    cue: 'asked what the call is about',
  },
  {
    moment: 'opener',
    re: /^(hi|hello|hey|yes|yeah|yep)?[,.!?\s]*(this is \w+|it'?s \w+|\w+ (here|speaking)|speaking|hello\??|hi\??|hey\??|yes\??|yeah\??)[.!?\s]*$/,
    confidence: 0.75,
    cue: 'picked up',
  },
  {
    moment: 'small_talk',
    re: /\b(how are you|how'?s it going|not bad|good,? thanks|doing well|can'?t complain|weather|weekend|how have you been|go on|fair enough|i'?m listening|tell me more|ok(ay)?,? (go on|shoot))\b/,
    confidence: 0.6,
    cue: 'chatting',
  },
];

/** The gatekeeper is putting the rep through: nothing to say but "thanks". */
const TRANSFERRING = /\b(put you through|putting you through|transfer(ring)? you|connect(ing)? you|hold on|one (sec|second|moment)|let me (see if|get|grab) (she|he|her|him|\w+)( is| can| 's)?)\b/;

function readMoment(text: string, persona: Persona): { moment: Moment; confidence: number; cue: string; quiet?: boolean } {
  // A gatekeeper's "what's this regarding?" is still the gatekeeper moment.
  if (persona === 'gatekeeper' && !/\b(leave (a|your) message|after the (tone|beep))\b/.test(text)) {
    if (TRANSFERRING.test(text)) return { moment: 'gatekeeper', confidence: 0.85, cue: 'putting you through', quiet: true };
    return { moment: 'gatekeeper', confidence: GATEKEEPER_SPEECH.test(text) ? 0.85 : 0.6, cue: 'talking to the gatekeeper' };
  }
  for (const r of MOMENT_RULES) if (r.re.test(text)) return { moment: r.moment, confidence: r.confidence, cue: r.cue };
  return { moment: 'other', confidence: 0.35, cue: 'no clear moment' };
}

/* ───────────── receptivity ───────────── */

const SIGNAL_WEIGHT: Partial<Record<ToneSignal, number>> = {
  friendly_phrase: 0.35,
  humour: 0.25,
  asked_question: 0.05,
  asked_price: 0.3,
  agreed_next_step: 0.45,
  referral_offered: 0.1,
  hostile_phrase: -1,
  one_word_answer: -0.35,
  time_pressure: -0.3,
  cut_rep_off: -0.2,
  long_pause: -0.35,
};

/** Moments where a short reply is normal, not curt. */
const SHORT_IS_NORMAL: ReadonlySet<Moment> = new Set(['opener', 'close', 'wrap_up', 'voicemail', 'gatekeeper']);

function receptivityDelta(text: string, signals: ToneSignal[], words: number, moment: Moment): number {
  let d = 0;
  for (const s of signals) d += SIGNAL_WEIGHT[s] ?? 0;
  // Curt: a short reply with no warmth in it.
  if (words <= 5 && !SHORT_IS_NORMAL.has(moment) && !signals.includes('friendly_phrase') && !signals.includes('humour') && !signals.includes('agreed_next_step')) d -= 0.4;
  // A question read flat ("What's this regarding.") lands colder than one asked.
  if (signals.includes('asked_question') && !text.includes('?') && words <= 6) d -= 0.25;
  if (/!/.test(text) && !signals.includes('hostile_phrase')) d += 0.1;
  return d;
}

/* ───────────── tone ───────────── */

function toneFor(score: number, signals: ToneSignal[], share: number): ReadMomentOutput['tone'] {
  const has = (s: ToneSignal) => (signals.includes(s) ? 1 : 0);
  return {
    engagement: clamp(0.25 + share * 0.5 + has('asked_question') * 0.15 - has('one_word_answer') * 0.2, 0, 1),
    warmth: clamp((score + 1) / 2, 0, 1),
    patience: clamp(0.75 - has('time_pressure') * 0.35 - has('hostile_phrase') * 0.35 - has('cut_rep_off') * 0.15, 0, 1),
    interest: clamp(0.3 + has('asked_question') * 0.15 + has('asked_price') * 0.35 + has('agreed_next_step') * 0.3 - has('hostile_phrase') * 0.3, 0, 1),
  };
}

/* ───────────── read ───────────── */

/**
 * The rules read of the moment: keyword + turn-shape heuristics over the latest turn in the window.
 * Used when Mubit is down or slow, in tests and in the demo. A rep turn is only ever read for
 * compliance. Deterministic.
 */
export function rulesReadMoment(input: ReadMomentInput): ReadMomentOutput {
  const last = input.window[input.window.length - 1];
  const prevScore = input.previous ? RECEPTIVITY_SCORE[input.previous.receptivity] : null;

  if (!last) {
    const score = prevScore ?? RECEPTIVITY_SCORE.neutral;
    return {
      persona: input.previous?.persona ?? personaFromTitle(input.crm.title),
      persona_confidence: 0.3,
      receptivity: receptivityFromScore(score),
      receptivity_score: score,
      moment: 'other',
      moment_confidence: 0.2,
      tone: toneFor(score, [], 0),
      signals: [],
      should_suggest: false,
      rationale: 'Nothing said yet',
    };
  }

  const text = normaliseText(last.text);

  if (last.speaker === 'rep') {
    const risky = findRiskyClaims(last.text);
    const score = prevScore ?? RECEPTIVITY_SCORE.neutral;
    const persona = input.previous?.persona ?? personaFromTitle(input.crm.title);
    return {
      persona,
      persona_confidence: 0.6,
      receptivity: receptivityFromScore(score),
      receptivity_score: score,
      moment: risky.length ? 'compliance' : (input.previous?.moment ?? 'other'),
      moment_confidence: risky.length ? 0.8 : 0.3,
      tone: toneFor(score, [], input.features.prospectShare),
      signals: [],
      should_suggest: risky.length > 0,
      rationale: risky.length ? `Rep claim needs care: ${risky[0]!.claim}`.slice(0, 300) : 'Rep is talking',
    };
  }

  const signals = detectSignals(last.text, input.features);
  const words = wordCount(last.text);
  const who = readPersona(text, input, signals);
  const what = readMoment(text, who.persona);

  // Drift, don't jump: keep 60% of the previous read, pulled towards neutral, then add this turn.
  // A new person on the line (gatekeeper → CEO) starts from neutral.
  const samePerson = input.previous?.persona === who.persona;
  const base = prevScore === null || !samePerson ? RECEPTIVITY_SCORE.neutral : 0.6 * prevScore + 0.4 * RECEPTIVITY_SCORE.neutral;
  const score = clamp(base + receptivityDelta(text, signals, words, what.moment), -1, 1);
  const receptivity = receptivityFromScore(score);

  const meta = MOMENT_META[what.moment];
  const quietSmallTalk = what.moment === 'small_talk' && score >= 0;
  const shouldSuggest = meta.suggests && !quietSmallTalk && !what.quiet && what.confidence >= 0.5;

  const parts = [what.cue];
  if (who.why) parts.push(who.why);
  if (signals.includes('one_word_answer') || (words <= 5 && score < 0)) parts.push('short reply');
  if (signals.includes('hostile_phrase')) parts.push('hostile wording');
  if (signals.includes('friendly_phrase')) parts.push('friendly wording');
  const rationale = parts.join('; ');

  return {
    persona: who.persona,
    persona_confidence: who.confidence,
    receptivity,
    receptivity_score: Math.round(score * 100) / 100,
    moment: what.moment,
    moment_confidence: what.confidence,
    tone: toneFor(score, signals, input.features.prospectShare),
    signals,
    should_suggest: shouldSuggest,
    rationale: rationale.charAt(0).toUpperCase() + rationale.slice(1),
  };
}

/** Converts a read_moment output (model or rules) into a schema-valid Situation: clamps numbers, camelCases, drops unknown signals. */
export function toSituation(o: ReadMomentOutput): Situation {
  const signals = TONE_SIGNALS.filter((s) => o.signals.includes(s));
  const score = clamp(o.receptivity_score, -1, 1);
  return {
    persona: o.persona,
    personaConfidence: clamp(o.persona_confidence, 0, 1),
    receptivity: o.receptivity,
    receptivityScore: score,
    moment: o.moment,
    momentConfidence: clamp(o.moment_confidence, 0, 1),
    tone: {
      engagement: clamp(o.tone.engagement, 0, 1),
      warmth: clamp(o.tone.warmth, 0, 1),
      patience: clamp(o.tone.patience, 0, 1),
      interest: clamp(o.tone.interest, 0, 1),
    },
    signals,
    shouldSuggest: o.should_suggest && MOMENT_META[o.moment].suggests,
    rationale: (o.rationale || '').trim().slice(0, 300),
  };
}
