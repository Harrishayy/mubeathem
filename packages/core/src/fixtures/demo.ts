import type { Moment, Receptivity } from '../taxonomy';
import { MOMENT_META, PERSONA_LABEL, RECEPTIVITY_LABEL } from '../taxonomy';
import type { Brief, Prospect, Rep, Speaker, Suggestion, Turn } from '../schema/domain';
import type { CallEvent, CallEventInput } from '../schema/events';
import type { CallReview, ReadMomentOutput } from '../schema/tasks';
import { buildCallRecord } from '../call/record';
import { applyReview } from '../playbook/apply';
import { rankLines } from '../playbook/bandit';
import { SEED_PLAYBOOK, upNextFor } from '../playbook/seed';
import { lineSimilarity } from '../playbook/similarity';
import { stepWin } from '../playbook/stepwin';
import { findRiskyClaims } from '../policy/rules';
import { computeFeatures } from '../signals/features';
import { rulesReadMoment, toSituation } from '../signals/rules';
import { seededRng, wordCount } from '../text';

/** The demo call's start time. Fixed so every fixture is byte-identical. */
export const DEMO_STARTED_AT = Date.UTC(2026, 9, 21, 15, 0, 0);
/** The demo call's id. */
export const DEMO_CALL_ID = 'call_demo_lumen';
/** Bandit seed for the demo log, chosen so the cards match what the rep says in the script. */
export const DEMO_SEED = 13;

/** The demo prospect (a fictional company): a CEO who raised a Series A in March. */
export const DEMO_PROSPECT: Prospect = {
  name: 'Maya Chen',
  title: 'CEO',
  company: 'Lumen Labs',
  phone: '+1 415 555 0142',
  email: 'maya@lumenlabs.example',
  crmId: 'hs_contact_48213',
  facts: {
    funding: 'Series A, $14M (March)',
    product: 'AI contract review for in-house legal teams',
    headcount: '38',
    hiring: '12 open roles, mostly engineering',
  },
};

/** The demo rep: nine days on the phones. */
export const DEMO_REP: Rep = { id: 'rep_alex', name: 'Alex Rivera', tenureDays: 9 };

export interface DemoLine {
  speaker: Speaker;
  text: string;
  /** The moment Cue should read on this turn. */
  expect?: Moment;
  /** Only in this run of the demo; untagged lines are in both. */
  variant?: 'warm' | 'cold';
  /** The receptivity Cue should read, where it matters to the demo. */
  receptivity?: Receptivity[];
}

/** The context.md §11 demo, both "what's this regarding?" variants included and tagged. */
export const DEMO_SCRIPT: DemoLine[] = [
  { speaker: 'rep', text: 'Hi, this is Alex calling from Corgi. Is Maya around?' },
  { speaker: 'prospect', text: "Hi Alex, Maya's in a meeting right now. Can I ask what it's regarding?", expect: 'gatekeeper' },
  { speaker: 'rep', text: "Totally fair. It's about the board's D&O cover after the raise. Is that usually Maya, or does your CFO handle it?" },
  { speaker: 'prospect', text: "That'd be Maya. Hold on, let me see if I can put you through.", expect: 'gatekeeper' },
  { speaker: 'prospect', text: 'Hi, this is Maya.', expect: 'opener' },
  { speaker: 'rep', text: "Maya, it's Alex at Corgi. Saw the Series A, congrats." },

  { speaker: 'prospect', variant: 'warm', text: "Oh, thanks! Sure, what's this regarding?", expect: 'whats_this_regarding', receptivity: ['warm'] },
  { speaker: 'rep', variant: 'warm', text: "It's about D&O. After a raise most boards want it sorted, and I wanted to check yours is." },
  { speaker: 'prospect', variant: 'warm', text: 'Oh, good timing actually. Go on.' },

  { speaker: 'prospect', variant: 'cold', text: "…Yeah. What's this regarding.", expect: 'whats_this_regarding', receptivity: ['cold'] },
  { speaker: 'rep', variant: 'cold', text: "Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go." },
  { speaker: 'prospect', variant: 'cold', text: 'Ha, fair enough. Go on.' },

  { speaker: 'rep', text: 'After a raise, the new board usually expects D&O to be in place, and AI products bring their own risks. Who looks after that for you?' },
  { speaker: 'prospect', text: 'We already have a broker, they set all that up when we raised the seed.', expect: 'objection_broker' },
  { speaker: 'rep', text: 'Makes sense, most founders do. Quick check though: did they re-quote you after the Series A, or is it still the seed policy?' },
  { speaker: 'prospect', text: 'Honestly, probably still the seed one. Would our AI product even be covered?', expect: 'buying_signal' },
  { speaker: 'rep', text: "Yeah, that'd definitely be covered.", expect: 'compliance' },
  { speaker: 'prospect', text: 'Okay, good. Roughly how much would something like that cost us?', expect: 'buying_signal' },
  { speaker: 'rep', text: "Easiest is fifteen minutes with our team, they'll quote you live. Thursday or Friday?" },
  { speaker: 'prospect', text: 'Thursday works. Send me the invite.', expect: 'close' },
  { speaker: 'rep', text: "Great, I'll send an invite for Thursday at two. Who else should be on it?" },
  { speaker: 'prospect', text: 'Just me and our CFO. Talk then.', expect: 'wrap_up' },
];

/** The script for one run of the demo. */
export function demoScript(variant: 'warm' | 'cold' = 'cold'): DemoLine[] {
  return DEMO_SCRIPT.filter((l) => !l.variant || l.variant === variant);
}

/** The pre-call brief the demo opens with. */
export const DEMO_BRIEF: Brief = {
  summary: 'Lumen Labs builds AI contract review for in-house legal teams. Raised a $14M Series A in March and is hiring fast.',
  hooks: [
    { hook: 'Series A in March: a new board and investors will expect D&O in place', product: 'd_and_o', via: 'fixture' },
    { hook: 'Their product makes calls on legal contracts, so AI liability and E&O matter', product: 'ai_liability', via: 'fixture' },
    { hook: '12 open roles, mostly engineering: EPLI as the team grows', product: 'epli', via: 'fixture' },
  ],
  opener: "Thanks for picking up, it's Corgi calling. Saw the raise, congrats. Quick one: has anyone talked to you about D&O since the board changed?",
  personaGuess: 'ceo',
  servedBy: 'rules',
};

const RING_MS = 4_000;
const GAP_MS = 700;
const MS_PER_WORD = 330;
const READ_MS = 380;
const CARD_MS = 950;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * A complete, realistic event log for the demo call, from `call.started` through
 * `playbook.updated`: interim and final turns, rules reads, bandit-ranked cards (seeded, so it is
 * identical on every run), the rep's slip and its compliance card, the booking, debrief and review.
 */
export function demoEvents(opts: { variant?: 'warm' | 'cold'; seed?: number } = {}): CallEvent[] {
  const variant = opts.variant ?? 'cold';
  const seed = opts.seed ?? DEMO_SEED;
  const script = demoScript(variant);
  const events: CallEvent[] = [];
  let seq = 0;
  const push = (e: CallEventInput & { at: number }) => {
    events.push({ ...e, seq: ++seq } as CallEvent);
  };
  const at = (tMs: number) => DEMO_STARTED_AT + tMs;
  const callId = DEMO_CALL_ID;

  push({ type: 'call.started', callId, at: DEMO_STARTED_AT, source: 'cue', prospect: DEMO_PROSPECT, rep: DEMO_REP });
  push({ type: 'brief.ready', callId, at: DEMO_STARTED_AT + 1_200, brief: DEMO_BRIEF });

  const turns: Turn[] = [];
  const shown: { suggestion: Suggestion; turnIndex: number }[] = [];
  let previous = null as ReadMomentOutput | null;
  let t = RING_MS;
  let open: Suggestion | null = null;
  // One generator for the whole call, as the server keeps one per call. Seeded: same log every run.
  const rng = seededRng(`${DEMO_CALL_ID}|${variant}|${seed}`);

  script.forEach((line, i) => {
    const id = `turn_demo_${pad(i + 1)}`;
    const durMs = Math.max(900, wordCount(line.text) * MS_PER_WORD);
    const turn: Turn = { id, speaker: line.speaker, text: line.text, tMs: t, durMs, final: true, via: 'sim' };

    // Long turns stream in: one interim partial before the final.
    if (wordCount(line.text) >= 8) {
      const partial = line.text.split(' ').slice(0, Math.ceil(wordCount(line.text) / 2)).join(' ');
      push({ type: 'turn.added', callId, at: at(t + Math.round(durMs / 2)), turn: { id, speaker: line.speaker, text: partial, tMs: t, final: false, via: 'sim' } });
    }
    const end = t + durMs;
    push({ type: 'turn.added', callId, at: at(end), turn });
    turns.push(turn);
    t = end + GAP_MS;

    // The rep saying the card on screen counts as using it.
    if (line.speaker === 'rep' && open && lineSimilarity(line.text, open.say) >= 0.6) {
      push({ type: 'suggestion.action', callId, at: at(end + 100), suggestionId: open.id, action: 'used' });
      if (open.situation.receptivity === 'cold') push({ type: 'suggestion.action', callId, at: at(end + 200), suggestionId: open.id, action: 'thumbs_up' });
      open = null;
    }

    const features = computeFeatures(turns, turns.length - 1);
    const window = turns.slice(-8).map((x) => ({ speaker: x.speaker, text: x.text, tMs: x.tMs }));
    const crm = { title: DEMO_PROSPECT.title, company: DEMO_PROSPECT.company, facts: DEMO_PROSPECT.facts };
    const prev = previous ? { persona: previous.persona, receptivity: previous.receptivity, moment: previous.moment } : null;

    if (line.speaker === 'rep') {
      const risky = findRiskyClaims(line.text)[0];
      if (!risky) return;
      const read = rulesReadMoment({ crm, window, features, previous: prev });
      push({
        type: 'policy.checked',
        callId,
        at: at(end + 250),
        check: { claim: risky.claim, verdict: 'violation', rule: risky.rule, rephrase: risky.rephrase, via: 'rules', speaker: 'rep', turnId: id },
      });
      const card: Suggestion = {
        id: `sug_demo_${pad(i + 1)}`,
        callId,
        turnId: id,
        situation: toSituation(read),
        say: risky.rephrase,
        why: "Coverage can't be promised before underwriting",
        lineId: 'line_seed_co_quote',
        evidence: { text: 'Policy: never promise a claim is covered before underwriting', calls: 0, basis: 'model' },
        upNext: upNextFor('compliance'),
        kind: 'compliance',
        compliance: { claim: risky.claim, verdict: 'violation', rule: risky.rule, rephrase: risky.rephrase },
        createdAt: at(end + 300),
        latencyMs: 300,
        servedBy: 'rules',
        mubitRequestIds: [],
      };
      push({ type: 'suggestion.shown', callId, at: card.createdAt, suggestion: card });
      shown.push({ suggestion: card, turnIndex: turns.length - 1 });
      open = null;
      return;
    }

    const read = rulesReadMoment({ crm, window, features, previous: prev });
    previous = read;
    const situation = toSituation(read);
    push({ type: 'situation.read', callId, at: at(end + READ_MS), turnId: id, situation, features, latencyMs: READ_MS, servedBy: 'rules' });

    const ranked = situation.shouldSuggest ? rankLines(SEED_PLAYBOOK, situation, { k: 3, rng }) : [];
    const top = ranked[0];
    if (!top) {
      push({ type: 'suggestion.skipped', callId, at: at(end + READ_MS + 20), turnId: id, reason: situation.shouldSuggest ? 'No playbook line for this moment' : `Quiet: ${MOMENT_META[situation.moment].short.toLowerCase()}` });
    } else {
      const card: Suggestion = {
        id: `sug_demo_${pad(i + 1)}`,
        callId,
        turnId: id,
        situation,
        say: top.line.text,
        why: `Top ${top.line.style} line for ${RECEPTIVITY_LABEL[situation.receptivity].toLowerCase()} ${PERSONA_LABEL[situation.persona]}s at this moment`,
        lineId: top.line.id,
        evidence: top.evidence,
        upNext: upNextFor(situation.moment),
        kind: 'line',
        createdAt: at(end + CARD_MS),
        latencyMs: CARD_MS,
        servedBy: 'rules',
        mubitRequestIds: [],
      };
      push({ type: 'suggestion.shown', callId, at: card.createdAt, suggestion: card });
      shown.push({ suggestion: card, turnIndex: turns.length - 1 });
      open = card;
    }
  });

  const last = turns[turns.length - 1]!;
  const callEnd = last.tMs + (last.durMs ?? 0) + 1_500;
  push({ type: 'call.ended', callId, at: at(callEnd), durationMs: callEnd });
  push({ type: 'outcome.recorded', callId, at: at(callEnd + 2_000), outcome: { outcome: 'meeting_booked', source: 'rep', raw: {}, at: at(callEnd + 2_000) } });

  const helpful = shown.filter((s) => s.suggestion.kind === 'compliance' || s.suggestion.situation.moment === 'whats_this_regarding').map((s) => s.suggestion.id);
  push({
    type: 'feedback.submitted',
    callId,
    at: at(callEnd + 21_000),
    feedback: {
      outcome: 'meeting_booked',
      rating: 5,
      attitude: variant === 'cold' ? 'guarded' : 'friendly',
      whatWorked: variant === 'cold' ? 'The self-aware line got a laugh and bought me the pitch.' : 'Getting straight to D&O after the raise landed.',
      whatDidnt: 'I said the AI product would be covered. Caught it, but I shouldn’t have.',
      betterLine: 'Did they re-quote you after the Series A, or is it still the seed policy?',
      helpful,
      unhelpful: [],
      submittedAt: at(callEnd + 21_000),
    },
  });

  const lineCards = shown.filter((s) => s.suggestion.kind === 'line');
  const usedIds = new Set(events.filter((e) => e.type === 'suggestion.action' && e.action === 'used').map((e) => (e as Extract<CallEvent, { type: 'suggestion.action' }>).suggestionId));
  const review: CallReview = {
    summary:
      'Got through the assistant, earned time with the CEO, handled the broker objection and booked a quote call for Thursday. One coverage promise needed correcting.',
    outcome: 'meeting_booked',
    linesUsed: lineCards.map(({ suggestion: s, turnIndex }) => {
      const repTurn = turns.slice(turnIndex + 1).find((x) => x.speaker === 'rep');
      const said = repTurn?.text ?? null;
      const used = usedIds.has(s.id);
      return {
        suggestionId: s.id,
        used,
        saidText: used ? said : null,
        similarity: said ? Math.round(lineSimilarity(said, s.say) * 100) / 100 : 0,
        stepWin: used && stepWin(s.situation.moment, turns.slice(turnIndex + 1), 'meeting_booked'),
      };
    }),
    candidateLines: [
      {
        moment: 'objection_broker',
        persona: 'ceo',
        receptivity: previous?.receptivity ?? 'neutral',
        text: 'Makes sense, most founders do. Quick check though: did they re-quote you after the Series A, or is it still the seed policy?',
        turnId: turns.find((x) => x.text.startsWith('Makes sense, most founders do. Quick check'))?.id ?? null,
        rationale: 'Sharper than the seed re-quote line: names the round, and the call went on to book.',
      },
    ],
    missedMoments: [],
    whatWorked: ['Used the gatekeeper line and got put through', 'Matched the CEO’s tone on "what’s this regarding?"', 'Went for the meeting on the price question'],
    whatDidnt: ['Promised coverage for the AI product before underwriting'],
    customerAttitude: variant === 'cold' ? 'guarded' : 'curious',
    coaching: ['When asked "would that be covered?", send it to the quote call instead of answering.'],
    suggestionImpact: 0.7,
  };
  const ignored = lineCards.find(({ suggestion: s }) => !usedIds.has(s.id) && s.situation.moment === 'buying_signal');
  if (ignored) review.missedMoments.push({ turnId: ignored.suggestion.turnId, moment: 'buying_signal', note: 'The card offered the meeting; the rep answered the coverage question instead.' });

  push({ type: 'review.completed', callId, at: at(callEnd + 27_000), review, servedBy: 'rules' });

  const applied = applyReview(SEED_PLAYBOOK, buildCallRecord(events), review, { now: at(callEnd + 27_500) });
  push({ type: 'playbook.updated', callId, at: at(callEnd + 27_500), lineIds: applied.changed, candidatesAdded: applied.candidates.map((c) => c.id) });

  return events;
}
