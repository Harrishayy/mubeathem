/** Drives one simulated practice call through the real pipeline and review (seed, live test). */
import type { Persona, Receptivity } from '@cue/core';
import type { CueServer } from '../boot';

/* ───────── the practice matrix ───────── */

interface Scenario {
  title: string;
  role?: Persona;
  mood: Receptivity;
  objections: string[];
}

export const SCENARIOS: Scenario[] = [
  { title: 'CEO', mood: 'warm', objections: ['We already have a broker.'] },
  { title: 'Co-founder & CEO', mood: 'cold', objections: ['Just send me an email.'] },
  { title: 'Executive Assistant to the CEO', role: 'gatekeeper', mood: 'neutral', objections: ["She's in back-to-back meetings."] },
  { title: 'CFO', mood: 'cool', objections: ['What does it cost?', 'We renew in March.'] },
  { title: 'Founding Engineer', role: 'engineer', mood: 'neutral', objections: ["Not interested, we're fine."] },
  { title: 'CEO', mood: 'cool', objections: ['Bad timing, call me next quarter.'] },
  { title: 'Head of Finance', mood: 'warm', objections: ['Our broker handles all of that.'] },
  { title: 'CTO', mood: 'cold', objections: ["I'm busy, what is this?"] },
];

export const COMPANIES: { name: string; person: string; facts: Record<string, string> }[] = [
  { name: 'Lumen Labs', person: 'Maya Chen', facts: { funding: 'Series A in March, $14M', product: 'AI scheduling for clinics', headcount: '28, hiring 9 roles' } },
  { name: 'Brightwire', person: 'Daniel Okafor', facts: { funding: 'Seed, $4M', product: 'Payments API for marketplaces', customers: 'Two enterprise pilots' } },
  { name: 'Northpeak Robotics', person: 'Sofia Reyes', facts: { funding: 'Series B in June', product: 'Warehouse robots', expansion: 'New office in Austin' } },
  { name: 'Quillstack', person: 'Tom Hartley', facts: { funding: 'Pre-seed', product: 'LLM evals for legal teams', headcount: '6' } },
  { name: 'Harbourline Health', person: 'Aisha Patel', facts: { funding: 'Series A, $22M', product: 'Remote patient monitoring', customers: 'NHS trust contract' } },
  { name: 'Vectorfold', person: 'Ben Ito', facts: { funding: 'Seed extension', product: 'AI code review', headcount: '15, hiring' } },
];

const OFF_SCRIPT = [
  'Totally fair. Can I ask how you handle insurance today?',
  "Understood. I'll keep it short: we quote D&O for startups in minutes.",
  'Makes sense. What would make this worth fifteen minutes for you?',
];

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (!check() && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
}

export interface CallResult {
  callId: string;
  scenario: string;
  turns: number;
  cards: number;
  used: number;
  outcome: string;
  turnToCardMs: number[];
}

export async function practiceCall(server: CueServer, i: number, rng: () => number, opts: { maxProspectTurns?: number } = {}): Promise<CallResult> {
  const { cue } = server;
  const sc = SCENARIOS[Math.floor(rng() * SCENARIOS.length)]!;
  const co = COMPANIES[Math.floor(rng() * COMPANIES.length)]!;
  const view = cue.createCall({
    source: 'practice',
    prospect: { name: co.person, title: sc.title, company: co.name, facts: co.facts },
    rep: { id: `rep_seed_${(i % 3) + 1}`, name: ['Alex', 'Jordan', 'Sam'][i % 3]!, tenureDays: [5, 60, 400][i % 3]! },
    practice: { mood: sc.mood, objections: sc.objections },
  });
  const callId = view.id;
  if (sc.role) cue.s.store.setPractice(callId, { mood: sc.mood, objections: sc.objections, role: sc.role });
  await waitFor(() => !!cue.getCall(callId).brief, 15_000);

  let booked = false;
  let ended = false;
  let turns = 0;
  for (let k = 0; k < (opts.maxProspectTurns ?? 6) && !ended; k++) {
    const reply = await cue.practiceNext(callId);
    await reply.done;
    turns++;
    booked = reply.booked;
    ended = reply.ended;
    if (ended) break;
    const v = cue.getCall(callId);
    const card = v.current && v.current.turnId === reply.turn.id ? v.current : null;
    const text = card && rng() < 0.8 ? card.say : k === 0 && v.brief ? v.brief.opener : OFF_SCRIPT[Math.floor(rng() * OFF_SCRIPT.length)]!;
    cue.addTurn(callId, { speaker: 'rep', text, final: true, via: 'sim' });
    await cue.repTurns.idle();
  }
  const outcome = booked ? 'meeting_booked' : ended ? (sc.mood === 'cold' ? 'not_interested' : 'follow_up') : 'callback_requested';
  cue.endCall(callId, { outcome });
  const v = cue.getCall(callId);
  cue.feedback(callId, {
    outcome,
    rating: booked ? 5 : ended ? 2 : 3,
    attitude: sc.mood === 'warm' ? 'friendly' : sc.mood === 'neutral' ? 'neutral' : sc.mood === 'cool' ? 'guarded' : 'irritated',
    helpful: v.history.filter((h) => h.action === 'used').map((h) => h.suggestion.id),
    unhelpful: [],
    ...(rng() < 0.3 ? { betterLine: 'Fair question. Most founders only look at this after a raise; has yours changed the board?' } : {}),
  });
  await cue.reviews.idle();
  const latest = cue.getCall(callId);
  return {
    callId,
    scenario: `${sc.title} · ${sc.mood}`,
    turns,
    cards: latest.history.length,
    used: latest.history.filter((h) => h.action === 'used').length,
    outcome,
    turnToCardMs: latest.history.filter((h) => h.suggestion.kind === 'line').map((h) => h.suggestion.latencyMs),
  };
}

