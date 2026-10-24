import { MOMENT_META, ReadMomentOutput, type Moment, type Receptivity } from '@cue/core';
import { MOMENT_LIST, PERSONA_LIST, RECEPTIVITY_LIST, SIGNAL_LIST } from './glossary';
import { clamp01, clamp11, type TaskDef } from './types';

const INSTRUCTIONS = `You read the moment on a live B2B cold call for Cue. The rep is a BDR at an insurance carrier for startups whose one goal is to book a meeting. After each prospect turn you return who is speaking (persona), how open they are (receptivity) and what their LAST turn just did (moment). A card is picked from your read within a second, so be decisive and consistent.

INPUT (JSON): crm (title, company, facts: a starting assumption the transcript overrides); window (recent turns, oldest first; the last prospect turn is the one you read); features (computed from the transcript: prospectShare = prospect share of words over the last 6 turns, shareTrend positive = opening up, replyLatencyMs, interrupted = prospect started before the rep finished, questionsAsked); previous (your read of the previous prospect turn, or null).

PERSONA
${PERSONA_LIST}
Start from crm.title; the transcript overrides it. If the rep asked for someone by name and the reply is not that person ("speaking", "this is Sam"), the speaker is a gatekeeper. Someone introducing their own role ("I'm the CFO") is that role. Otherwise keep previous.persona.

RECEPTIVITY
${RECEPTIVITY_LIST}
Words first, then shape: one-word or clipped replies, interrupted, long pauses and a falling share push colder; questions back, longer answers, humour and a rising share push warmer. A flat, clipped question ("…yeah. what's this regarding.", "who is this.", "who gave you this number?") is cold, even straight after a friendly greeting. Otherwise move at most one step from previous.receptivity unless the turn is clearly inviting. receptivity_score must sit inside the chosen band.

MOMENT: what the last prospect turn does, read in context of the rep's turn before it
${MOMENT_LIST}
Decide in this order and stop at the first that fits:
1. No live person: voicemail.
2. A screener, not the decision-maker: gatekeeper.
3. Agrees to a meeting or time, or asks for the invite, and details remain: close. Everything already settled and they are signing off: wrap_up.
4. Asks for a guarantee or promise: compliance.
5. Asks about price, cover, quotes, the process or the next step: buying_signal, even when it comes after an objection.
6. Asks for something to be sent: brush_off_email. Busy, call later: brush_off_busy. Broker, insurer or current setup: objection_broker. A reason or period for "not now": objection_timing. Budget or cost complaint: objection_price. Flat no: objection_not_interested.
7. Asks who is calling or what it is about: whats_this_regarding.
8. Picks up, or lets the rep continue ("go on", "okay", "I'm listening", "good timing"): opener. This is never buying_signal.
9. Pleasantries: small_talk. Else other.

SIGNALS (only those in the last prospect turn, no repeats)
${SIGNAL_LIST}

TONE: engagement, warmth, patience, interest, each 0 to 1, describing the conversation, never diagnosing the person.
SHOULD_SUGGEST: true for every moment except voicemail, small_talk, wrap_up and other, and except when the last prospect turn is clearly cut off mid-sentence. Always true for close and buying_signal.
CONFIDENCE: 0 to 1; 0.9 or more only when the words leave no doubt.
RATIONALE: at most 15 words quoting the deciding words. No names, no emotions.

EXAMPLES
Input: {"crm":{"title":"CEO","company":"Northwind","facts":{}},"window":[{"speaker":"rep","text":"Hi, is Sam there?","tMs":2000},{"speaker":"prospect","text":"He's in a meeting. Can I ask what it's about?","tMs":4100}],"features":{"turnIndex":1,"prospectWords":10,"repWords":5,"prospectShare":0.67,"shareTrend":0,"interrupted":false,"questionsAsked":1,"elapsedMs":4100},"previous":null}
Output: {"persona":"gatekeeper","persona_confidence":0.92,"receptivity":"neutral","receptivity_score":0.2,"moment":"gatekeeper","moment_confidence":0.93,"tone":{"engagement":0.5,"warmth":0.5,"patience":0.6,"interest":0.3},"signals":["asked_question"],"should_suggest":true,"rationale":"Screening: 'he's in a meeting, can I ask what it's about'"}

Input: {"crm":{"title":"Founder & CEO","company":"Kitebase","facts":{"stage":"Seed"}},"window":[{"speaker":"rep","text":"Priya, it's Jordan calling, have you got thirty seconds?","tMs":3000},{"speaker":"prospect","text":"Who is this. What's it about.","tMs":5200}],"features":{"turnIndex":1,"prospectWords":6,"repWords":10,"prospectShare":0.38,"shareTrend":-0.2,"interrupted":true,"questionsAsked":2,"elapsedMs":5200},"previous":null}
Output: {"persona":"ceo","persona_confidence":0.8,"receptivity":"cold","receptivity_score":-0.75,"moment":"whats_this_regarding","moment_confidence":0.88,"tone":{"engagement":0.3,"warmth":0.1,"patience":0.15,"interest":0.15},"signals":["cut_rep_off","asked_question"],"should_suggest":true,"rationale":"Clipped 'who is this, what's it about' after cutting the rep off"}

Input: {"crm":{"title":"CEO","company":"Northwind","facts":{}},"window":[{"speaker":"rep","text":"Fair. When did they last re-quote you?","tMs":30000},{"speaker":"prospect","text":"No idea. Does that cover us if a customer sues over a bug?","tMs":33500}],"features":{"turnIndex":8,"prospectWords":13,"repWords":7,"prospectShare":0.55,"shareTrend":0.15,"interrupted":false,"questionsAsked":2,"elapsedMs":33500},"previous":{"persona":"ceo","receptivity":"neutral","moment":"objection_broker"}}
Output: {"persona":"ceo","persona_confidence":0.9,"receptivity":"neutral","receptivity_score":0.4,"moment":"buying_signal","moment_confidence":0.85,"tone":{"engagement":0.7,"warmth":0.5,"patience":0.6,"interest":0.7},"signals":["asked_question"],"should_suggest":true,"rationale":"Asks 'does that cover us if a customer sues'"}

Reply with the JSON object only.`;

const ALWAYS_SUGGEST = new Set<Moment>(['close', 'buying_signal', 'compliance']);

/** Mirrors receptivityFromScore in core. */
const BANDS: Record<Receptivity, [number, number]> = { warm: [0.6, 1], neutral: [-0.05, 0.6], cool: [-0.65, -0.05], cold: [-1, -0.65] };

export const readMoment: TaskDef<'read_moment'> = {
  id: 'read_moment',
  tier: 'fast',
  version: 2,
  instructions: INSTRUCTIONS,
  output: ReadMomentOutput,
  maxOutputTokens: 400,
  temperature: 0,
  normalize(o) {
    const [lo, hi] = BANDS[o.receptivity];
    // Keep the label the model chose and pull the score into its band, so meters and labels agree.
    const score = Math.min(hi, Math.max(lo, clamp11(o.receptivity_score)));
    // whats_this_regarding is the decision-maker asking; a screener asking the same thing is a gatekeeper.
    const moment = o.persona === 'gatekeeper' && o.moment === 'whats_this_regarding' ? 'gatekeeper' : o.moment;
    return {
      ...o,
      moment,
      persona_confidence: clamp01(o.persona_confidence),
      moment_confidence: clamp01(o.moment_confidence),
      receptivity_score: score,
      tone: { engagement: clamp01(o.tone.engagement), warmth: clamp01(o.tone.warmth), patience: clamp01(o.tone.patience), interest: clamp01(o.tone.interest) },
      signals: [...new Set(o.signals)].slice(0, 12),
      // The pipeline's contract: never a card on quiet moments, always one when it's time to book or protect.
      should_suggest: !MOMENT_META[moment].suggests ? false : ALWAYS_SUGGEST.has(moment) ? true : o.should_suggest,
      rationale: o.rationale.slice(0, 300),
    };
  },
};
