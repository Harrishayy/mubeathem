/**
 * The fixed vocabulary Cue reasons in. Everything Cue learns is keyed on a situation:
 * who (persona) + how receptive they are + what just happened (moment).
 *
 * These lists are the contract between the model tasks, the playbook, the UI and Mubit's
 * training data. Adding a value is safe; renaming one splits history, so don't.
 */

export const PERSONAS = ['gatekeeper', 'ceo', 'cfo', 'engineer', 'other_exec', 'unknown'] as const;
export type Persona = (typeof PERSONAS)[number];

export const RECEPTIVITY = ['warm', 'neutral', 'cool', 'cold'] as const;
export type Receptivity = (typeof RECEPTIVITY)[number];

export const MOMENTS = [
  'opener',
  'gatekeeper',
  'whats_this_regarding',
  'brush_off_email',
  'brush_off_busy',
  'objection_broker',
  'objection_not_interested',
  'objection_price',
  'objection_timing',
  'buying_signal',
  'close',
  'small_talk',
  'compliance',
  'voicemail',
  'wrap_up',
  'other',
] as const;
export type Moment = (typeof MOMENTS)[number];

/** The accent family a moment is drawn in. Maps 1:1 to `--moment-<family>` tokens in @cue/ui. */
export const MOMENT_FAMILIES = ['gatekeeper', 'opener', 'cold', 'objection', 'signal', 'close', 'compliance', 'neutral'] as const;
export type MomentFamily = (typeof MOMENT_FAMILIES)[number];

/** What a step is for, so each moment can be scored before the meeting is (or isn't) booked. */
export const STEP_JOBS = ['get_through', 'earn_time', 'keep_alive', 'book', 'protect', 'none'] as const;
export type StepJob = (typeof STEP_JOBS)[number];

export interface MomentMeta {
  id: Moment;
  label: string;
  /** Short label for chips and the collapsed overbar. */
  short: string;
  /** Icon name in @cue/ui's icon set. Never an emoji in UI chrome. */
  icon: string;
  family: MomentFamily;
  job: StepJob;
  /** Plain-English win rule, shown in the playbook and sent to review_call. */
  winRule: string;
  /** Whether Cue should ever show a card for this moment. */
  suggests: boolean;
}

export const MOMENT_META: Record<Moment, MomentMeta> = {
  opener: { id: 'opener', label: 'Opener', short: 'Opener', icon: 'wave', family: 'opener', job: 'earn_time', winRule: 'Prospect still talking 30 s later', suggests: true },
  gatekeeper: { id: 'gatekeeper', label: 'Gatekeeper', short: 'Gatekeeper', icon: 'door', family: 'gatekeeper', job: 'get_through', winRule: "Transferred, or got the decision-maker's name or best time", suggests: true },
  whats_this_regarding: { id: 'whats_this_regarding', label: '"What\'s this regarding?"', short: 'What\'s this re?', icon: 'question', family: 'cold', job: 'earn_time', winRule: 'Prospect asks a follow-up instead of ending the call', suggests: true },
  brush_off_email: { id: 'brush_off_email', label: 'Brush-off: "send me an email"', short: 'Send an email', icon: 'mail', family: 'cold', job: 'keep_alive', winRule: 'Call continues past the next two turns', suggests: true },
  brush_off_busy: { id: 'brush_off_busy', label: 'Brush-off: "I\'m busy"', short: 'Busy', icon: 'clock', family: 'cold', job: 'keep_alive', winRule: 'Call continues past the next two turns', suggests: true },
  objection_broker: { id: 'objection_broker', label: 'Objection: "we have a broker"', short: 'Have a broker', icon: 'shield', family: 'objection', job: 'keep_alive', winRule: 'Call continues past the next two turns', suggests: true },
  objection_not_interested: { id: 'objection_not_interested', label: 'Objection: "not interested"', short: 'Not interested', icon: 'shield', family: 'objection', job: 'keep_alive', winRule: 'Call continues past the next two turns', suggests: true },
  objection_price: { id: 'objection_price', label: 'Objection: price', short: 'Price', icon: 'shield', family: 'objection', job: 'keep_alive', winRule: 'Call continues past the next two turns', suggests: true },
  objection_timing: { id: 'objection_timing', label: 'Objection: timing', short: 'Bad timing', icon: 'shield', family: 'objection', job: 'keep_alive', winRule: 'Call continues past the next two turns', suggests: true },
  buying_signal: { id: 'buying_signal', label: 'Buying signal', short: 'Buying signal', icon: 'spark', family: 'signal', job: 'book', winRule: 'Meeting booked', suggests: true },
  close: { id: 'close', label: 'Close', short: 'Close', icon: 'calendar', family: 'close', job: 'book', winRule: 'Meeting booked', suggests: true },
  small_talk: { id: 'small_talk', label: 'Small talk', short: 'Small talk', icon: 'chat', family: 'neutral', job: 'none', winRule: '—', suggests: false },
  compliance: { id: 'compliance', label: 'Compliance', short: 'Compliance', icon: 'alert', family: 'compliance', job: 'protect', winRule: 'No policy breach on the call', suggests: true },
  voicemail: { id: 'voicemail', label: 'Voicemail', short: 'Voicemail', icon: 'voicemail', family: 'neutral', job: 'none', winRule: '—', suggests: false },
  wrap_up: { id: 'wrap_up', label: 'Wrap-up', short: 'Wrap-up', icon: 'check', family: 'close', job: 'book', winRule: 'Meeting booked', suggests: false },
  other: { id: 'other', label: 'Other', short: 'Other', icon: 'dot', family: 'neutral', job: 'none', winRule: '—', suggests: false },
};

export const PERSONA_LABEL: Record<Persona, string> = {
  gatekeeper: 'Gatekeeper',
  ceo: 'CEO',
  cfo: 'CFO',
  engineer: 'Engineer',
  other_exec: 'Exec',
  unknown: 'Unknown',
};

export const RECEPTIVITY_LABEL: Record<Receptivity, string> = {
  warm: 'Warm',
  neutral: 'Neutral',
  cool: 'Cooling',
  cold: 'Cold',
};

/** Receptivity as a number for meters and trends: warm = 1, cold = -1. */
export const RECEPTIVITY_SCORE: Record<Receptivity, number> = { warm: 1, neutral: 0.25, cool: -0.4, cold: -1 };

export function receptivityFromScore(score: number): Receptivity {
  if (score >= 0.6) return 'warm';
  if (score >= -0.05) return 'neutral';
  if (score >= -0.65) return 'cool';
  return 'cold';
}

/**
 * Word-level tone signals read from the transcript. These describe the conversation, never a
 * diagnosis of the person (no voice biometrics, no emotion labels on people: context.md §13).
 */
export const TONE_SIGNALS = [
  'one_word_answer',
  'cut_rep_off',
  'long_pause',
  'asked_question',
  'asked_price',
  'hostile_phrase',
  'friendly_phrase',
  'time_pressure',
  'humour',
  'referral_offered',
  'second_voice',
  'agreed_next_step',
] as const;
export type ToneSignal = (typeof TONE_SIGNALS)[number];

/** Insurance lines Corgi sells; research hooks and lines are tagged with them. */
export const PRODUCT_LINES = ['d_and_o', 'e_and_o', 'cyber', 'epli', 'ai_liability', 'general_liability', 'other'] as const;
export type ProductLine = (typeof PRODUCT_LINES)[number];

export const PRODUCT_LABEL: Record<ProductLine, string> = {
  d_and_o: 'D&O',
  e_and_o: 'E&O',
  cyber: 'Cyber',
  epli: 'EPLI',
  ai_liability: 'AI liability',
  general_liability: 'General liability',
  other: 'Other',
};

/** Sapling-compatible verdicts (context.md §8). `unsure` is the calibrated status. */
export const POLICY_VERDICTS = ['supported', 'violation', 'insufficient_information', 'inconsistent_context', 'unsure'] as const;
export type PolicyVerdict = (typeof POLICY_VERDICTS)[number];

/** Outcomes, in Cue's words. Trellus/HubSpot dispositions map onto these (packages/trellus). */
export const OUTCOMES = ['meeting_booked', 'follow_up', 'not_interested', 'gatekeeper_blocked', 'voicemail', 'no_answer', 'wrong_person', 'callback_requested', 'unknown'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  meeting_booked: 'Meeting booked',
  follow_up: 'Follow-up agreed',
  not_interested: 'Not interested',
  gatekeeper_blocked: 'Blocked at gatekeeper',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  wrong_person: 'Wrong person',
  callback_requested: 'Callback requested',
  unknown: 'Unknown',
};

/** The rep's read of the customer's attitude, from the post-call debrief. */
export const ATTITUDES = ['friendly', 'curious', 'neutral', 'guarded', 'irritated', 'hostile'] as const;
export type Attitude = (typeof ATTITUDES)[number];

/** Why a situation key looks the way it does: `${persona}.${receptivity}.${moment}`. */
export function situationKey(s: { persona: Persona; receptivity: Receptivity; moment: Moment }): string {
  return `${s.persona}.${s.receptivity}.${s.moment}`;
}
