/**
 * UI-only fixtures: one card of every type from context.md §4.3 and the pieces to build them, for
 * the gallery and tests. The demo call itself comes from @cue/core (`demoEvents`, `reduceCall`).
 * Every object here parses against the core schemas (test/fixtures.test.ts).
 */
import type { CallEvent, Evidence, Moment, PolicyCheck, Situation, Suggestion, UpNext } from '@cue/core';
import { DEMO_CALL_ID, DEMO_STARTED_AT, RECEPTIVITY_SCORE, type Persona, type Receptivity } from '@cue/core';

const DEMO_T0 = DEMO_STARTED_AT;

/** A situation with sensible defaults; override what matters. */
export function situation(moment: Moment, persona: Persona = 'ceo', receptivity: Receptivity = 'neutral', extra: Partial<Situation> = {}): Situation {
  return {
    persona,
    personaConfidence: 0.86,
    receptivity,
    receptivityScore: RECEPTIVITY_SCORE[receptivity],
    moment,
    momentConfidence: 0.9,
    tone: { engagement: 0.6, warmth: receptivity === 'warm' ? 0.8 : receptivity === 'cold' ? 0.2 : 0.5, patience: 0.5, interest: 0.5 },
    signals: [],
    shouldSuggest: true,
    rationale: 'Prospect asked a direct question after the opener.',
    ...extra,
  };
}

const ev = (text: string, calls: number, winRate?: number, basis: Evidence['basis'] = 'bandit'): Evidence => ({ text, calls, winRate, basis });

interface CardSpec {
  moment: Moment;
  persona?: Persona;
  receptivity?: Receptivity;
  say: string;
  why: string;
  evidence: Evidence;
  upNext?: UpNext[];
}

/** The card types from context.md §4.3, in demo order. Keyed by a short name. */
export const CARD_SPECS = {
  gatekeeper: {
    moment: 'gatekeeper',
    persona: 'gatekeeper',
    say: "Totally fair. It's about the board's D&O cover after the raise. Is that usually Maya, or does your CFO handle it?",
    why: 'Names a real reason and offers two easy answers.',
    evidence: ev('Transferred or got a name 14 of 38 times here', 38, 14 / 38),
    upNext: [
      { ifTheySay: 'Can I take a message?', move: 'Ask for the best time to catch her', moment: 'gatekeeper' },
      { ifTheySay: "She doesn't take these calls", move: 'Ask who owns insurance', moment: 'gatekeeper' },
    ],
  },
  opener: {
    moment: 'opener',
    say: "Maya, it's Alex at Corgi. Saw the Series A, congrats. Quick one: has anyone talked to you about D&O since the board changed?",
    why: 'Recent raise: the board change is the hook.',
    evidence: ev('Still talking 30 s later on 22 of 31 calls with CEOs who just raised', 31, 22 / 31),
    upNext: [
      { ifTheySay: "What's this regarding?", move: 'One-line answer, then the question', moment: 'whats_this_regarding' },
      { ifTheySay: "I'm busy", move: 'Ask for thirty seconds', moment: 'brush_off_busy' },
    ],
  },
  regardingWarm: {
    moment: 'whats_this_regarding',
    receptivity: 'warm',
    say: "It's D&O for the new board. Two minutes on whether your cover kept up with the Series A?",
    why: 'Warm and curious: a straight answer wins here.',
    evidence: ev('Follow-up question on 19 of 27 warm CEOs', 27, 19 / 27),
    upNext: [
      { ifTheySay: 'We have a broker', move: 'Ask when they last re-quoted', moment: 'objection_broker' },
      { ifTheySay: 'Send me an email', move: 'Ask what it should answer', moment: 'brush_off_email' },
    ],
  },
  regardingCold: {
    moment: 'whats_this_regarding',
    receptivity: 'cold',
    say: "Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.",
    why: 'Cold and short: self-aware beats the pitch.',
    evidence: ev('Books 2.1× more than the straight answer with cold CEOs · 41 calls', 41, 0.34),
    upNext: [
      { ifTheySay: 'We have a broker', move: 'Ask about the last re-quote', moment: 'objection_broker' },
      { ifTheySay: 'Send me an email', move: 'Ask for 15 minutes instead', moment: 'brush_off_email' },
    ],
  },
  broker: {
    moment: 'objection_broker',
    receptivity: 'cool',
    say: 'Makes sense, most founders do. When did they last re-quote you after a raise?',
    why: 'Agree, then a question they rarely have an answer to.',
    evidence: ev('Call kept going on 26 of 40 broker objections', 40, 26 / 40),
    upNext: [
      { ifTheySay: 'Last year, I think', move: 'Offer a side-by-side quote', moment: 'buying_signal' },
      { ifTheySay: "We're happy with them", move: 'Ask what they would change', moment: 'objection_not_interested' },
    ],
  },
  email: {
    moment: 'brush_off_email',
    receptivity: 'cool',
    say: "Happy to. So it's actually useful, what's the one thing you'd want it to answer?",
    why: 'Turns the brush-off into a question.',
    evidence: ev('New line, on trial: 3 calls so far', 3, undefined, 'explore'),
  },
  signal: {
    moment: 'buying_signal',
    receptivity: 'warm',
    say: "Easiest is fifteen minutes with our team, they'll quote you live. Thursday or Friday?",
    why: 'They asked about price: go for the meeting.',
    evidence: ev('Booked 9 of 17 times after a price question', 17, 9 / 17),
    upNext: [{ ifTheySay: 'Thursday works', move: 'Confirm time and send the invite', moment: 'close' }],
  },
  close: {
    moment: 'close',
    receptivity: 'warm',
    say: "Perfect. Thursday at 2 with Sam from our team. I'll send the invite to maya@lumenlabs.ai now.",
    why: 'Lock the time and the person while they are on the line.',
    evidence: ev('No history yet for this line', 0, undefined, 'model'),
  },
} satisfies Record<string, CardSpec>;

export type CardName = keyof typeof CARD_SPECS;

let n = 0;
/** Builds a schema-valid Suggestion from a spec. */
export function suggestionFrom(spec: CardSpec, over: Partial<Suggestion> = {}): Suggestion {
  n += 1;
  return {
    id: `sug_demo_${spec.moment}_${n}`,
    callId: DEMO_CALL_ID,
    turnId: `turn_demo_${n}`,
    situation: situation(spec.moment, spec.persona ?? 'ceo', spec.receptivity ?? 'neutral'),
    say: spec.say,
    why: spec.why,
    lineId: `line_${spec.moment}_1`,
    evidence: spec.evidence,
    upNext: spec.upNext ?? [],
    kind: 'line',
    createdAt: DEMO_T0 + n * 1000,
    latencyMs: 1180,
    servedBy: 'mubit',
    mubitRequestIds: ['mbt_req_7f3a91', 'mbt_req_7f3a92'],
    ...over,
  };
}

export const DEMO_FLAG: PolicyCheck = {
  claim: "That'd definitely be covered under your policy.",
  verdict: 'violation',
  rule: "Never promise a specific claim will be covered before underwriting.",
  rephrase: "That's exactly what the quote call will confirm.",
  via: 'sapling',
  speaker: 'rep',
  turnId: 'turn_demo_rep_claim',
};

export function complianceSuggestion(over: Partial<Suggestion> = {}): Suggestion {
  return suggestionFrom(
    {
      moment: 'compliance',
      say: DEMO_FLAG.rephrase!,
      why: "Coverage can't be promised before underwriting.",
      evidence: ev('Policy check by Sapling', 0, undefined, 'model'),
    },
    { kind: 'compliance', compliance: { claim: DEMO_FLAG.claim, verdict: 'violation', rule: DEMO_FLAG.rule, rephrase: DEMO_FLAG.rephrase! }, ...over },
  );
}

/* ───────── time rebasing ───────── */

const TIME_KEYS = new Set(['at', 'createdAt', 'submittedAt']);

function shiftDeep<T>(value: T, delta: number): T {
  if (Array.isArray(value)) return value.map((v) => shiftDeep(v, delta)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = TIME_KEYS.has(k) && typeof v === 'number' ? v + delta : shiftDeep(v, delta);
    return out as T;
  }
  return value;
}

/** Moves a call's timestamps so it started at `startedAt` (live timers then read sensibly). */
export function rebaseEvents(events: CallEvent[], startedAt: number): CallEvent[] {
  const t0 = events.find((e) => e.type === 'call.started')?.at ?? events[0]?.at ?? startedAt;
  return shiftDeep(events, startedAt - t0);
}
