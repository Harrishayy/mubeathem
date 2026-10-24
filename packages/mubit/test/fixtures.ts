import type { Moment, Receptivity, TaskId, TaskInput, TaskOutput, TurnFeatures } from '@cue/core';

/**
 * Realistic inputs for every task, built around the context.md §11 demo (Maya Chen, CEO of Lumen Labs,
 * Series A in March). Used by the offline tests, the live tests and scripts/smoke.ts.
 */

export const CRM = { title: 'CEO', company: 'Lumen Labs', facts: { stage: 'Series A', raised: 'March 2026', headcount: '38' } };
export const PROSPECT = { name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs' };
export const REP = { name: 'Alex', company: 'Corgi' };
export const POLICY = ['Never promise a specific claim will be covered.', 'Never quote a premium before a quote is generated.'];

export function features(over: Partial<TurnFeatures> = {}): TurnFeatures {
  return { turnIndex: 3, prospectWords: 8, repWords: 14, prospectShare: 0.4, shareTrend: 0, interrupted: false, questionsAsked: 1, elapsedMs: 20_000, ...over };
}

type Window = TaskInput<'read_moment'>['window'];

/** Labelled lines for read_moment accuracy (agents/02_mubit.md). */
export interface LabelledRead {
  name: string;
  expect: Moment;
  /** Acceptable receptivities, when the case is about receptivity. */
  receptivity?: Receptivity[];
  input: TaskInput<'read_moment'>;
}

const opener: Window = [
  { speaker: 'prospect', text: 'Maya speaking.', tMs: 1500 },
  { speaker: 'rep', text: "Hi Maya, it's Alex at Corgi. Saw the Series A, congrats. Have you got thirty seconds?", tMs: 3000 },
];

export const LABELLED_READS: LabelledRead[] = [
  {
    name: 'gatekeeper',
    expect: 'gatekeeper',
    input: {
      crm: CRM,
      window: [
        { speaker: 'rep', text: 'Hi, is Maya around?', tMs: 2000 },
        { speaker: 'prospect', text: "She's in back-to-back meetings all afternoon. Can I take a message, or tell her what it's in reference to?", tMs: 4200 },
      ],
      features: features({ turnIndex: 1, prospectWords: 20, repWords: 4, prospectShare: 0.83, questionsAsked: 1, elapsedMs: 4200 }),
      previous: null,
    },
  },
  {
    name: "warm what's this regarding",
    expect: 'whats_this_regarding',
    receptivity: ['warm', 'neutral'],
    input: {
      crm: CRM,
      window: [...opener, { speaker: 'prospect', text: "Oh, thanks! Sure, I've got a minute. What's this regarding?", tMs: 6500 }],
      features: features({ turnIndex: 2, prospectWords: 11, prospectShare: 0.45, shareTrend: 0.1, replyLatencyMs: 400, elapsedMs: 6500 }),
      previous: { persona: 'ceo', receptivity: 'neutral', moment: 'opener' },
    },
  },
  {
    name: "cold what's this regarding",
    expect: 'whats_this_regarding',
    receptivity: ['cool', 'cold'],
    input: {
      crm: CRM,
      window: [...opener, { speaker: 'prospect', text: "...what's this regarding.", tMs: 7800 }],
      features: features({ turnIndex: 2, prospectWords: 3, prospectShare: 0.2, shareTrend: -0.3, replyLatencyMs: 2600, interrupted: true, elapsedMs: 7800 }),
      previous: { persona: 'ceo', receptivity: 'neutral', moment: 'opener' },
    },
  },
  {
    name: 'broker objection',
    expect: 'objection_broker',
    input: {
      crm: CRM,
      window: [
        { speaker: 'rep', text: "Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.", tMs: 9000 },
        { speaker: 'prospect', text: "Ha. Okay, but we already have a broker who handles all of that for us.", tMs: 13000 },
      ],
      features: features({ turnIndex: 4, prospectWords: 14, prospectShare: 0.5, shareTrend: 0.1, elapsedMs: 13000 }),
      previous: { persona: 'ceo', receptivity: 'cool', moment: 'whats_this_regarding' },
    },
  },
  {
    name: 'email brush-off',
    expect: 'brush_off_email',
    input: {
      crm: CRM,
      window: [
        { speaker: 'rep', text: "It's about your D&O cover after the raise. Has anyone looked at it since March?", tMs: 9000 },
        { speaker: 'prospect', text: 'Look, just send me an email and I will take a look when I get a chance.', tMs: 12500 },
      ],
      features: features({ turnIndex: 4, prospectWords: 16, prospectShare: 0.5, shareTrend: -0.1, elapsedMs: 12500 }),
      previous: { persona: 'ceo', receptivity: 'neutral', moment: 'whats_this_regarding' },
    },
  },
  {
    name: 'price question',
    expect: 'buying_signal',
    input: {
      crm: CRM,
      window: [
        { speaker: 'rep', text: 'Most founders we talk to after a Series A find their board expects D&O in place within a quarter.', tMs: 40000 },
        { speaker: 'prospect', text: 'Yeah, our board did bring that up. Roughly what would something like that cost for a team our size?', tMs: 45000 },
      ],
      features: features({ turnIndex: 10, prospectWords: 20, prospectShare: 0.55, shareTrend: 0.2, questionsAsked: 3, elapsedMs: 45000 }),
      previous: { persona: 'ceo', receptivity: 'neutral', moment: 'objection_broker' },
    },
  },
  {
    name: 'voicemail',
    expect: 'voicemail',
    input: {
      crm: CRM,
      window: [{ speaker: 'prospect', text: "Hi, you've reached Maya Chen at Lumen Labs. I can't take your call right now, please leave a message after the tone.", tMs: 3000 }],
      features: features({ turnIndex: 0, prospectWords: 22, repWords: 0, prospectShare: 1, elapsedMs: 3000 }),
      previous: null,
    },
  },
  {
    name: 'busy brush-off',
    expect: 'brush_off_busy',
    input: {
      crm: CRM,
      window: [...opener, { speaker: 'prospect', text: "I'm literally walking into a board meeting. Can you try me later?", tMs: 6000 }],
      features: features({ turnIndex: 2, prospectWords: 12, prospectShare: 0.4, elapsedMs: 6000 }),
      previous: { persona: 'ceo', receptivity: 'neutral', moment: 'opener' },
    },
  },
];

export const INPUTS: { [K in TaskId]: TaskInput<K> } = {
  read_moment: LABELLED_READS[0]!.input,
  write_line: {
    situation: { persona: 'ceo', receptivity: 'cold', moment: 'whats_this_regarding', signals: ['one_word_answer', 'cut_rep_off'] },
    lastProspectTurn: "...what's this regarding.",
    window: [
      { speaker: 'prospect', text: 'Maya speaking.' },
      { speaker: 'rep', text: "Hi Maya, it's Alex at Corgi. Saw the Series A, congrats. Have you got thirty seconds?" },
      { speaker: 'prospect', text: "...what's this regarding." },
    ],
    candidates: [
      { line_id: 'line_wtr_selfaware', text: "Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.", style: 'self-aware', shown: 41, used: 33, step_wins: 19, booked: 7, sampled_win_rate: 0.47 },
      { line_id: 'line_wtr_straight', text: "It's about your D&O cover after the raise. Has anyone looked at it since?", style: 'straight', shown: 39, used: 31, step_wins: 9, booked: 3, sampled_win_rate: 0.26 },
    ],
    hooks: [
      { hook: 'Raised a Series A in March with two new board members', product: 'd_and_o' },
      { hook: 'Ships an AI underwriting assistant to lenders', product: 'ai_liability' },
    ],
    prospect: PROSPECT,
    rep: REP,
    alreadySaid: ["Hi Maya, it's Alex at Corgi. Saw the Series A, congrats."],
  },
  research_brief: {
    prospect: { ...PROSPECT, facts: CRM.facts },
    findings: [
      { title: 'Lumen Labs raises $14M Series A for AI document review', text: 'Lumen Labs, whose AI assistant reviews loan documents for mid-size lenders, raised a $14M Series A led by Example Capital in March, adding two board seats.', url: 'https://news.example.com/lumen-series-a', publishedAt: '2026-03-12' },
      { title: 'Careers at Lumen Labs', text: '12 open roles across engineering, sales and customer success, including the first hires in London.', url: 'https://lumenlabs.example.com/careers', publishedAt: null },
    ],
    seller: { company: 'Corgi', offer: 'Insurance for startups: D&O, E&O, cyber, EPLI, AI liability' },
  },
  check_claim: {
    claim: 'Yeah, something like that would definitely be covered.',
    speaker: 'rep',
    policy: POLICY,
    evidence: ['No quote has been generated.', 'Underwriting has not started.', 'Prospect asked whether a lawsuit from a lender over an AI error would be covered.'],
  },
  review_call: {
    record: {
      callId: 'call_demo_fixture',
      source: 'practice',
      startedAt: 1_792_800_000_000,
      durationMs: 95_000,
      prospect: { ...PROSPECT, facts: CRM.facts },
      rep: { id: 'rep_alex', name: 'Alex', tenureDays: 21 },
      transcript: [
        { id: 'turn_1', speaker: 'prospect', text: 'Maya speaking.', tMs: 1500 },
        { id: 'turn_2', speaker: 'rep', text: "Hi Maya, it's Alex at Corgi. Saw the Series A, congrats. Got thirty seconds?", tMs: 3000 },
        { id: 'turn_3', speaker: 'prospect', text: "...what's this regarding.", tMs: 7800 },
        { id: 'turn_4', speaker: 'rep', text: "Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.", tMs: 9500 },
        { id: 'turn_5', speaker: 'prospect', text: 'Ha. Fine. We already have a broker though.', tMs: 13000 },
        { id: 'turn_6', speaker: 'rep', text: 'Makes sense, most founders do. When did they last re-quote you after a raise?', tMs: 15000 },
        { id: 'turn_7', speaker: 'prospect', text: "Honestly, not since the seed. Would a lender suing us over an AI mistake be covered?", tMs: 20000 },
        { id: 'turn_8', speaker: 'rep', text: "That's exactly what the quote call will confirm. Fifteen minutes with our team, Thursday or Friday?", tMs: 23000 },
        { id: 'turn_9', speaker: 'prospect', text: 'Thursday at two works.', tMs: 26000 },
        { id: 'turn_10', speaker: 'rep', text: "Perfect, I'll send the invite to your email now. Thanks Maya.", tMs: 28000 },
      ],
      situations: [
        { turnId: 'turn_3', tMs: 7800, persona: 'ceo', receptivity: 'cold', receptivityScore: -0.75, moment: 'whats_this_regarding', tone: { engagement: 0.3, warmth: 0.1, patience: 0.2, interest: 0.2 }, signals: ['one_word_answer'], features: features({ turnIndex: 2, elapsedMs: 7800 }) },
        { turnId: 'turn_5', tMs: 13000, persona: 'ceo', receptivity: 'cool', receptivityScore: -0.3, moment: 'objection_broker', tone: { engagement: 0.5, warmth: 0.4, patience: 0.4, interest: 0.3 }, signals: ['humour'], features: features({ turnIndex: 4, elapsedMs: 13000 }) },
        { turnId: 'turn_7', tMs: 20000, persona: 'ceo', receptivity: 'neutral', receptivityScore: 0.3, moment: 'compliance', tone: { engagement: 0.7, warmth: 0.5, patience: 0.6, interest: 0.7 }, signals: ['asked_question'], features: features({ turnIndex: 6, elapsedMs: 20000 }) },
      ],
      suggestions: [
        { id: 'sug_1', turnId: 'turn_3', lineId: 'line_wtr_selfaware', moment: 'whats_this_regarding', situationKey: 'ceo.cold.whats_this_regarding', say: "Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.", kind: 'line', shownAtMs: 8900, latencyMs: 1100, servedBy: 'mubit', actions: [{ action: 'used', text: null, atMs: 9400 }], used: null, stepWin: null, mubitRequestIds: [] },
        { id: 'sug_2', turnId: 'turn_5', lineId: 'line_broker_requote', moment: 'objection_broker', situationKey: 'ceo.cool.objection_broker', say: 'Makes sense, most founders do. When did they last re-quote you after a raise?', kind: 'line', shownAtMs: 14200, latencyMs: 1200, servedBy: 'mubit', actions: [], used: null, stepWin: null, mubitRequestIds: [] },
        { id: 'sug_3', turnId: 'turn_7', lineId: 'line_compliance_quotecall', moment: 'compliance', situationKey: 'ceo.neutral.compliance', say: "Good question, and that's what the quote call confirms. Could you do fifteen minutes this week?", kind: 'compliance', shownAtMs: 21500, latencyMs: 1500, servedBy: 'mubit', actions: [{ action: 'thumbs_up', text: null, atMs: 24000 }], used: null, stepWin: null, mubitRequestIds: [] },
      ],
      policyChecks: [],
      receptivityTrend: [
        { tMs: 7800, score: -0.75 },
        { tMs: 13000, score: -0.3 },
        { tMs: 20000, score: 0.3 },
        { tMs: 26000, score: 0.7 },
      ],
      outcome: { outcome: 'meeting_booked', source: 'rep', raw: {} },
      feedback: { outcome: 'meeting_booked', rating: 5, attitude: 'curious', whatWorked: 'The self-aware line got me past the cold start', whatDidnt: null, betterLine: null, helpful: ['sug_1', 'sug_3'], unhelpful: [], notes: null },
      trellus: null,
    },
    playbookContext: [
      { line_id: 'line_wtr_selfaware', moment: 'whats_this_regarding', text: "Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go." },
      { line_id: 'line_broker_requote', moment: 'objection_broker', text: 'Makes sense, most founders do. When did they last re-quote you after a raise?' },
    ],
  },
  simulate_prospect: {
    persona: { role: 'ceo', name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs', mood: 'cool', objections: ['we already have a broker', 'send me an email'], facts: CRM.facts },
    transcript: [
      { speaker: 'prospect', text: 'Maya speaking.' },
      { speaker: 'rep', text: "Hi Maya, it's Alex at Corgi. Saw the Series A, congrats. Have you got thirty seconds?" },
    ],
  },
  live_cue: {
    prospect: { name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs' },
    rep: { name: 'Alex', company: 'Corgi' },
    brief: { summary: 'AI document review for law firms.', opener: '', risk: 'Wrong answers in client contracts.', policies: ['Technology E&O: AI errors in client work'], facts: ['Form D verified: Round still open, $1.3M of $9.9M left'] },
    playbook: [{ line_id: 'line_wtr_selfaware', moment: 'whats_this_regarding', style: 'self-aware', text: "Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.", used: 41, wins: 22, booked: 6 }],
    previous: { persona: 'ceo', receptivity: 'neutral', moment: 'opener' },
    transcript: [
      { speaker: 'rep', text: "Hi Maya, it's Alex at Corgi." },
      { speaker: 'prospect', text: "...what's this regarding." },
    ],
    already_said: [],
  },
  synth_brief: {
    company: 'Lumen Labs',
    domain: 'lumenlabs.ai',
    sources: 'Company: Lumen Labs\nDomain: lumenlabs.ai\nForm D: $8.6M sold of $9.9M\nPages on their own domain:\n1. Lumen Labs | AI document review — https://lumenlabs.ai/\n   Lumen reviews loan documents for mid-size lenders with an AI assistant.',
  },
};

/** A schema-valid answer per task, for the fake fetch. */
export const OUTPUTS: { [K in TaskId]: TaskOutput<K> } = {
  read_moment: { persona: 'gatekeeper', persona_confidence: 0.9, receptivity: 'neutral', receptivity_score: 0.2, moment: 'gatekeeper', moment_confidence: 0.9, tone: { engagement: 0.5, warmth: 0.5, patience: 0.5, interest: 0.3 }, signals: ['asked_question'], should_suggest: true, rationale: 'Screening for the CEO' },
  write_line: { say: "Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.", why: 'Cold and short', line_id: 'line_wtr_selfaware', up_next: [], risky_claim: null },
  research_brief: { summary: 'AI document review startup', hooks: [], opener: 'Saw the Series A, congrats.', persona_guess: 'ceo' },
  check_claim: { verdict: 'violation', rule: POLICY[0]!, rephrase: "That's what the quote call confirms.", confidence: 0.9 },
  review_call: { summary: 'Booked', outcome: 'meeting_booked', lines_used: [], candidate_lines: [], missed_moments: [], what_worked: [], what_didnt: [], customer_attitude: 'curious', coaching: [], suggestion_impact: 0.6 },
  simulate_prospect: { reply: 'We already have a broker.', intended_moment: 'objection_broker', mood_now: 'cool', ends_call: false, books_meeting: false },
  live_cue: {
    meaning: 'Guarded, wants the point fast',
    moment: 'whats_this_regarding',
    persona: 'ceo',
    receptivity: 'cold',
    line_id: 'line_wtr_selfaware',
    say: "Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go.",
    why: 'Cold and clipped',
    up_next: [{ if_they_say: 'We already have a broker', move: 'Ask when they last re-quoted', moment: 'objection_broker' }],
    risky_claim: null,
  },
  synth_brief: {
    trigger: "you're reviewing loan documents for mid-size lenders",
    blurb: 'An AI document review startup. It sells loan-document review to mid-size lenders.',
    kind: 'AI document review',
    does: 'Reviews loan documents with an AI assistant',
    targeting: 'Mid-size lenders',
    employees: '',
    founded: '',
    city: '',
    stage: '',
    valuation: '',
    people: [{ name: 'Maya Chen', role: 'CEO' }],
    risk: 'A wrong AI review of a loan file costs a lender money and lands on them.',
    policies: [{ name: 'Technology E&O / Tech & AI Liability', reason: 'AI errors in client loan reviews' }],
  },
};
