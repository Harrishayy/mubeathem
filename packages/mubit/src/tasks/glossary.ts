import {
  ATTITUDES,
  MOMENTS,
  MOMENT_META,
  OUTCOMES,
  PERSONAS,
  POLICY_VERDICTS,
  PRODUCT_LINES,
  RECEPTIVITY,
  TONE_SIGNALS,
  type Attitude,
  type Moment,
  type Outcome,
  type Persona,
  type PolicyVerdict,
  type ProductLine,
  type Receptivity,
  type ToneSignal,
} from '@cue/core';

/**
 * One-line definitions of every taxonomy value, shared by the task instructions. The records are
 * typed exhaustively, so adding a value in core fails typecheck here until it has a definition.
 *
 * Everything below renders to fixed strings at module load. Changing a word changes the task's
 * instructions and therefore starts a new Mubit task: bump the task's `version` when you do.
 */

export const PERSONA_DEFS: Record<Persona, string> = {
  gatekeeper: 'someone screening calls for the decision-maker: assistant, receptionist, office manager, a colleague offering to take a message or asking what it is about on their behalf',
  ceo: 'CEO, founder, co-founder, president or managing director',
  cfo: 'CFO, VP or head of finance, finance director, controller',
  engineer: 'CTO, VP engineering, an engineer or technical lead (cares about AI liability and E&O, not board D&O)',
  other_exec: 'any other decision-maker: COO, head of operations, people, legal or another VP',
  unknown: 'not enough to tell who is speaking',
};

export const RECEPTIVITY_DEFS: Record<Receptivity, string> = {
  warm: 'score 0.6 to 1. Friendly and open: greets the rep, asks questions back, gives time, laughs',
  neutral: 'score -0.05 to 0.6. Polite and listening but guarded, neither inviting nor shutting down',
  cool: 'score -0.65 to -0.05. Short replies, hedging, impatience, sighing, trying to steer to the exit',
  cold: 'score -1 to -0.65. Curt, clipped or hostile: a flat question ending in a full stop, "who gave you this number?", cutting the rep off, wanting the call over',
};

export const MOMENT_DEFS: Record<Moment, string> = {
  opener: 'the decision-maker answers or gives the rep the floor ("hi, this is Sam", "speaking", "sure, go ahead", "go on", "okay, I\'m listening"); the rep must now earn time by giving the reason for the call',
  gatekeeper: 'someone screening for the decision-maker: asks who is calling or what it is about on their behalf, says they are unavailable, offers to take a message, or puts the rep through',
  whats_this_regarding: 'the decision-maker, or a colleague who just joined, asks who is calling or what the call is about before giving time ("what\'s this regarding?", "is this a sales call?", "who gave you this number?")',
  brush_off_email: 'wants something sent instead of talking now ("send me an email", "sure, send me something", "send over some info")',
  brush_off_busy: 'busy right now and asks to be called back later or another day',
  objection_broker: 'already has a broker or insurer, or is happy with their current cover or setup',
  objection_not_interested: 'a flat refusal: "not interested", "we don\'t need that", "take me off your list"',
  objection_price: 'cost as a complaint: too expensive, no budget, already paying too much',
  objection_timing: 'not now for a stated reason or period: "after our raise", "next quarter", "at renewal"',
  buying_signal: 'explicit interest in buying: asks about price, what is covered, how quotes or the process work, or what the next step is; or names a live need (a board asking, a contract requiring it). Permission to keep talking ("go on", "I\'m listening", "good timing") is not a buying signal',
  close: 'agrees to a meeting or a time, or asks for the invite, while details are still open (time, invite, who attends); the rep should lock it in',
  small_talk: 'pleasantries or chat off the topic ("how are you", "mad week", weather, weekend)',
  compliance: 'asks the rep to guarantee or promise what only underwriting can decide ("can you guarantee that?", "so it\'s definitely covered?"); a plain question about what is covered is buying_signal',
  voicemail: 'no live person: a voicemail greeting, "leave a message after the tone", a carrier recording',
  wrap_up: 'the meeting is agreed and its details settled; the prospect confirms or says goodbye ("just me and our CFO, talk then", "see you Thursday")',
  other: 'none of the above, or the turn is too fragmentary to read',
};

export const SIGNAL_DEFS: Record<ToneSignal, string> = {
  one_word_answer: 'the prospect answered in one to three words',
  cut_rep_off: 'the prospect interrupted the rep (features.interrupted is true, or the rep turn is cut off)',
  long_pause: 'a long gap before replying (features.replyLatencyMs above about 2500)',
  asked_question: 'the prospect asked a question',
  asked_price: 'the prospect asked about price, cost, premium or quotes',
  hostile_phrase: 'rude or hostile words ("who gave you this number", "stop calling")',
  friendly_phrase: 'warm words ("oh nice", "happy to help", "good to hear from you")',
  time_pressure: 'mentions being short of time ("I have two minutes", "make it quick")',
  humour: 'the prospect joked or laughed',
  referral_offered: 'names or offers someone else to talk to',
  second_voice: 'a second person joins or is mentioned as listening in',
  agreed_next_step: 'agreed to a meeting, call-back or another concrete next step',
};

export const PRODUCT_DEFS: Record<ProductLine, string> = {
  d_and_o: 'directors and officers cover; boards and new investors expect it after a raise',
  e_and_o: 'errors and omissions / professional liability; enterprise contracts often require it',
  cyber: 'cyber liability; data breaches, security incidents, customer security reviews',
  epli: 'employment practices liability; fast hiring and a growing team',
  ai_liability: 'liability for harm caused by an AI product or model output',
  general_liability: 'general liability; offices, events, physical presence in a new market',
  other: 'any other line',
};

export const VERDICT_DEFS: Record<PolicyVerdict, string> = {
  supported: 'the claim is allowed by the policy and consistent with the evidence',
  violation: 'saying the claim breaks a policy rule, whether or not it might turn out true',
  insufficient_information: 'no rule is clearly broken, but the claim states a fact the evidence does not establish',
  inconsistent_context: 'the claim contradicts the evidence (e.g. says a quote exists when the evidence says none has been generated)',
  unsure: 'you cannot decide with reasonable confidence',
};

export const OUTCOME_DEFS: Record<Outcome, string> = {
  meeting_booked: 'a meeting was booked with a date or time',
  follow_up: 'a concrete follow-up was agreed but no meeting booked',
  not_interested: 'the prospect declined',
  gatekeeper_blocked: 'never got past the gatekeeper',
  voicemail: 'reached voicemail',
  no_answer: 'nobody answered',
  wrong_person: 'reached someone who is not the buyer and no referral',
  callback_requested: 'the prospect asked to be called back at another time',
  unknown: 'cannot tell',
};

export const ATTITUDE_DEFS: Record<Attitude, string> = {
  friendly: 'warm and easy throughout',
  curious: 'interested, asked questions',
  neutral: 'polite, neither warm nor resistant',
  guarded: 'cautious, giving little away',
  irritated: 'impatient or annoyed',
  hostile: 'rude or aggressive',
};

/** `- id: definition` per line, in the taxonomy's order. */
export function list<K extends string>(ids: readonly K[], defs: Record<K, string>): string {
  return ids.map((id) => `- ${id}: ${defs[id]}`).join('\n');
}

export const PERSONA_LIST = list(PERSONAS, PERSONA_DEFS);
export const RECEPTIVITY_LIST = list(RECEPTIVITY, RECEPTIVITY_DEFS);
export const MOMENT_LIST = list(MOMENTS, MOMENT_DEFS);
export const SIGNAL_LIST = list(TONE_SIGNALS, SIGNAL_DEFS);
export const PRODUCT_LIST = list(PRODUCT_LINES, PRODUCT_DEFS);
export const VERDICT_LIST = list(POLICY_VERDICTS, VERDICT_DEFS);
export const OUTCOME_LIST = list(OUTCOMES, OUTCOME_DEFS);
export const ATTITUDE_LIST = list(ATTITUDES, ATTITUDE_DEFS);

/** Each moment's job and win rule from core (context.md §6.2). */
export const WIN_RULE_LIST = MOMENTS.map((m) => `- ${m}: job ${MOMENT_META[m].job}; win when ${MOMENT_META[m].winRule === '—' ? 'n/a (never scored)' : MOMENT_META[m].winRule.toLowerCase()}`).join('\n');

/** The spoken-line rules every task that writes something for the rep to say follows (context.md §4). */
export const LINE_RULES = `- One breath: at most 25 words, usually 10 to 20. One or two short sentences.
- Plain spoken English with contractions, the way a confident rep talks. No jargon, no buzzwords, no exclamation marks, no emoji.
- Never promise coverage, a price, a premium, a claim outcome or terms before underwriting. No "definitely covered", "guaranteed", "cheapest", "you'll save". Point to the quote call instead.
- Never invent facts. Use only what the input gives you about the prospect and their company.
- Use the prospect's first name sparingly: at most once per line, only when it helps (openers, the ask), never in two lines in a row.
- End by handing the turn back: a short question or a clear ask.`;
