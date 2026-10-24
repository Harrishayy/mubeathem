/**
 * Named CallViews for every state the UI must render, plus playbook and Mubit stats fixtures. Built
 * from core's demo call (`demoEvents` + `reduceCall`), rebased so live timers read sensibly.
 */
import type { CallEvent, CallView, PlaybookResponse, StatsResponse, Suggestion } from '@cue/core';
import { DEMO_CALL_ID, DEMO_STARTED_AT, demoEvents, reduceCall } from '@cue/core';
import { CARD_SPECS, complianceSuggestion, rebaseEvents, suggestionFrom } from './demo';
import { STRESS } from './stress';

const DEMO_T0 = DEMO_STARTED_AT;

/** Gallery fixtures pretend the call started 2:14 ago, as in the context.md §4.1 sketch. */
export function galleryEvents(variant: 'cold' | 'warm' = 'cold', startedAt = Date.now() - 134_000): CallEvent[] {
  return rebaseEvents(demoEvents({ variant }), startedAt);
}

/** The view after replaying events up to and including the first match. */
function viewAt(pred: (e: CallEvent) => boolean, variant: 'cold' | 'warm' = 'cold'): CallView {
  const events = galleryEvents(variant);
  const idx = events.findIndex(pred);
  return reduceCall(events.slice(0, idx < 0 ? events.length : idx + 1));
}

const shownFor = (moment: string) => (e: CallEvent) => e.type === 'suggestion.shown' && e.suggestion.kind === 'line' && e.suggestion.situation.moment === moment;

export const VIEWS = {
  /** Dialled, prospect hasn't spoken. */
  ringing: () => viewAt((e) => e.type === 'brief.ready'),
  /** Prospect just finished; Cue is reading the moment. */
  thinking: () => viewAt((e) => e.type === 'turn.added' && e.turn.final && e.turn.speaker === 'prospect' && e.turn.text.includes('regarding.')),
  gatekeeper: () => viewAt(shownFor('gatekeeper')),
  opener: () => viewAt(shownFor('opener')),
  cold: () => viewAt(shownFor('whats_this_regarding')),
  warm: () => viewAt(shownFor('whats_this_regarding'), 'warm'),
  objection: () => viewAt(shownFor('objection_broker')),
  compliance: () => viewAt((e) => e.type === 'suggestion.shown' && e.suggestion.kind === 'compliance'),
  signal: () => viewAt(shownFor('buying_signal')),
  close: () => viewAt(shownFor('close')),
  /** Quiet: a read with nothing to say. */
  quiet: (): CallView => ({ ...viewAt((e) => e.type === 'suggestion.skipped' && e.reason.startsWith('Quiet')), current: null }),
  ended: () => viewAt((e) => e.type === 'call.ended'),
  booked: () => viewAt((e) => e.type === 'outcome.recorded'),
  reviewing: () => viewAt((e) => e.type === 'feedback.submitted'),
  reviewed: () => viewAt(() => false),
  error: (): CallView => ({ ...viewAt(shownFor('objection_broker')), lastError: { stage: 'write_line', message: 'Mubit timed out, so this is the top playbook line as written.' } }),
  /** Every string at its limit: long names, long line, unbroken tokens, emoji, CJK. */
  stress: (): CallView => stressView(viewAt(shownFor('whats_this_regarding'))),
} satisfies Record<string, () => CallView>;

export type ViewName = keyof typeof VIEWS;

export function stressSuggestion(base?: Suggestion): Suggestion {
  const s = base ?? suggestionFrom(CARD_SPECS.regardingCold);
  return {
    ...s,
    say: STRESS.line,
    why: STRESS.why,
    evidence: { ...s.evidence, text: STRESS.evidence },
    upNext: [
      { ifTheySay: STRESS.ifTheySay, move: STRESS.move, moment: 'objection_not_interested' },
      { ifTheySay: STRESS.token.slice(0, 60), move: STRESS.cjk, moment: 'brush_off_email' },
      { ifTheySay: '🙃 We just raised 🚀', move: 'Ask about the board 🧑‍⚖️', moment: 'opener' },
    ],
  };
}

function stressView(v: CallView): CallView {
  return {
    ...v,
    prospect: { ...v.prospect, name: STRESS.name, title: STRESS.title, company: STRESS.company, facts: { stage: STRESS.token, note: STRESS.cjk } },
    current: v.current ? stressSuggestion(v.current) : null,
    brief: v.brief && {
      ...v.brief,
      summary: STRESS.summary,
      hooks: [...v.brief.hooks, { hook: STRESS.hook, product: 'other', source: `https://example.com/${STRESS.token}`, via: 'exa' }],
      opener: STRESS.line,
    },
    turns: [...v.turns, { id: 'turn_stress', speaker: 'prospect', text: `${STRESS.long} ${STRESS.token} ${STRESS.cjk}`, tMs: 40000, final: true, via: 'sim' }],
    flags: [{ claim: STRESS.long.slice(0, 400), verdict: 'unsure', rule: STRESS.why, rephrase: STRESS.line, via: 'rules', speaker: 'rep' }],
  };
}

export const COMPLIANCE_SUGGESTION = (): Suggestion => complianceSuggestion();

/* ───────── playbook ───────── */

const stats = (shown: number, used: number, stepWins: number, booked: number) => ({ '*': { shown, used, stepWins, booked, lost: Math.max(0, used - booked - 2) } });

export const DEMO_PLAYBOOK: PlaybookResponse = {
  updatedAt: DEMO_T0 + 90_000,
  lines: [
    { id: 'line_gk_1', moment: 'gatekeeper', personas: ['gatekeeper'], receptivity: [], text: CARD_SPECS.gatekeeper.say, style: 'question', products: ['d_and_o'], status: 'active', origin: 'seed', createdAt: DEMO_T0 - 9e8, stats: stats(52, 38, 14, 4) },
    { id: 'line_wtr_cold', moment: 'whats_this_regarding', personas: ['ceo'], receptivity: ['cold', 'cool'], text: CARD_SPECS.regardingCold.say, style: 'self-aware', products: [], status: 'active', origin: 'rep', createdAt: DEMO_T0 - 6e8, stats: stats(60, 41, 22, 7) },
    { id: 'line_wtr_straight', moment: 'whats_this_regarding', personas: ['ceo'], receptivity: [], text: CARD_SPECS.regardingWarm.say, style: 'straight', products: ['d_and_o'], status: 'active', origin: 'seed', createdAt: DEMO_T0 - 9e8, stats: stats(70, 48, 19, 3) },
    { id: 'line_broker_1', moment: 'objection_broker', personas: [], receptivity: [], text: CARD_SPECS.broker.say, style: 'question', products: [], status: 'active', origin: 'seed', createdAt: DEMO_T0 - 9e8, stats: stats(55, 40, 26, 6) },
    {
      id: 'line_cand_1',
      moment: 'brush_off_email',
      personas: ['ceo'],
      receptivity: ['cool'],
      text: "Sure. If I send it, will you actually read it, or should I just book fifteen minutes and save us both the email?",
      style: 'self-aware',
      products: [],
      status: 'candidate',
      origin: 'rep',
      createdAt: DEMO_T0 + 85_000,
      stats: {},
      minedFrom: { callId: DEMO_CALL_ID, turnId: 'turn_demo_r4', repId: 'rep_jordan' },
      policy: { verdict: 'supported' },
    },
    {
      id: 'line_cand_2',
      moment: 'objection_price',
      personas: [],
      receptivity: [],
      text: "We're almost always cheaper than your broker, guaranteed.",
      style: 'proof',
      products: [],
      status: 'candidate',
      origin: 'rep',
      createdAt: DEMO_T0 + 86_000,
      stats: {},
      minedFrom: { callId: 'call_01JOTHER', repId: 'rep_sam' },
      policy: { verdict: 'violation', note: 'Price promise before a quote is generated.' },
    },
  ],
  leaderboard: [
    {
      moment: 'whats_this_regarding',
      lines: [
        { lineId: 'line_wtr_cold', text: CARD_SPECS.regardingCold.say, evidence: { text: 'Books 2.1× more than the straight answer with cold CEOs', calls: 41, winRate: 0.54, basis: 'bandit' } },
        { lineId: 'line_wtr_straight', text: CARD_SPECS.regardingWarm.say, evidence: { text: 'Follow-up on 19 of 48', calls: 48, winRate: 0.4, basis: 'bandit' } },
      ],
    },
    { moment: 'gatekeeper', lines: [{ lineId: 'line_gk_1', text: CARD_SPECS.gatekeeper.say, evidence: { text: 'Transferred or got a name 14 of 38', calls: 38, winRate: 0.37, basis: 'bandit' } }] },
    {
      moment: 'objection_broker',
      lines: [
        { lineId: 'line_broker_1', text: CARD_SPECS.broker.say, evidence: { text: 'Kept going on 26 of 40', calls: 40, winRate: 0.65, basis: 'bandit' } },
        { lineId: 'line_broker_2', text: 'Great. Would a second quote hurt?', evidence: { text: 'New line, on trial', calls: 3, winRate: 0.33, basis: 'explore' } },
      ],
    },
  ],
};

/* ───────── Mubit stats ───────── */

const task = (t: StatsResponse['tasks'][number]['task'], model: string, calls: number, p50: number, cost: number): StatsResponse['tasks'][number] => ({
  task: t,
  model,
  calls,
  ok: Math.max(0, calls - Math.floor(calls / 20)),
  failed: Math.floor(calls / 20),
  sessions: Math.ceil(calls / 4),
  p50Ms: p50,
  p95Ms: Math.round(p50 * 2.1),
  inputTokens: calls * 1400,
  outputTokens: calls * 160,
  costUsd: cost,
  adapterThreshold: 25,
  lastRequestId: calls ? `mbt_req_${t}_${calls.toString(16)}` : null,
});

export const DEMO_STATS: StatsResponse = {
  tasks: [
    task('read_moment', 'gpt-4o-mini', 64, 610, 0.0214),
    task('write_line', 'gpt-4.1-mini', 41, 920, 0.0582),
    task('research_brief', 'gpt-4.1-mini', 18, 2400, 0.0311),
    task('check_claim', 'gpt-4o-mini', 9, 480, 0.0019),
    task('review_call', 'gpt-4.1-mini', 26, 3100, 0.0904),
    task('simulate_prospect', 'gpt-4o-mini', 0, 0, 0),
  ],
  calls: { total: 31, booked: 6, reviewed: 26, withFeedback: 22 },
  playbook: { active: 23, candidates: 2 },
};
