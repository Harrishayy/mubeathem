import type { Persona, Receptivity, SimulateProspectOutput, Turn } from '@cue/core';
import { newId, personaFromTitle } from '../adapters/core';
import { clip, clipTail, type Services } from '../services/context';
import type { PracticeState } from '../store/events';
import type { TurnPipeline } from './turn';

export interface PracticeReply {
  turn: Turn;
  ended: boolean;
  booked: boolean;
  /** Settles when the normal pipeline has handled the reply (seeding waits on it; the route doesn't). */
  done: Promise<void>;
}

export class PracticeError extends Error {
  constructor(
    readonly code: 'not_found' | 'call_ended',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Practice mode: `simulate_prospect` plays the prospect. Mood drifts with the conversation (the sim
 * reports `mood_now`, kept on the call), and its reply goes through the normal pipeline as a `sim` turn.
 */
export async function practiceNext(s: Services, pipeline: TurnPipeline, callId: string): Promise<PracticeReply> {
  const row = s.store.call(callId);
  const view = s.store.view(callId);
  if (!row || !view) throw new PracticeError('not_found', `No call ${callId}`);
  if (view.status !== 'live') throw new PracticeError('call_ended', 'The call has ended');
  const practice: PracticeState = row.practice ?? { mood: 'neutral', objections: [] };
  const role = (practice.role as Persona | undefined) ?? personaFromTitle(view.prospect.title);
  const transcript = view.turns.filter((t) => t.final).slice(-16).map((t) => ({ speaker: t.speaker, text: clipTail(t.text, 500) }));

  const r = await s.models.run(
    'simulate_prospect',
    {
      persona: { role, name: view.prospect.name, title: view.prospect.title, company: view.prospect.company, mood: practice.mood, objections: practice.objections, facts: view.prospect.facts },
      transcript,
    },
    { callId, budgetMs: s.config.budgets.simMs },
  );
  const out: SimulateProspectOutput = r.ok ? r.output : rulesProspect(view.turns.filter((t) => t.final && t.speaker === 'prospect').length, practice, view.prospect.name);
  if (r.ok) s.telemetry.link(r.requestId, callId, 'simulate_prospect');

  const latest = s.store.view(callId);
  if (!latest || latest.status !== 'live') throw new PracticeError('call_ended', 'The call has ended');
  s.store.setPractice(callId, { ...practice, mood: out.mood_now, ended: out.ends_call, booked: out.books_meeting });
  const turn: Turn = {
    id: newId('turn'),
    speaker: 'prospect',
    text: clip(out.reply || '…', 4000),
    tMs: Math.max(0, s.now() - latest.startedAt),
    final: true,
    via: r.ok ? 'sim' : 'sim:rules',
  };
  const receivedAt = s.now();
  s.store.append({ type: 'turn.added', callId, turn });
  const done = pipeline.handle(callId, turn.id, receivedAt);
  return { turn, ended: out.ends_call, booked: out.books_meeting, done };
}

/** A scripted prospect for when Mubit isn't available: opener → regarding → objection → price → close. */
export function rulesProspect(prospectTurns: number, p: PracticeState, name: string): SimulateProspectOutput {
  const cold = p.mood === 'cold' || p.mood === 'cool';
  const objection = p.objections[0] ?? 'We already have a broker.';
  const script: [string, SimulateProspectOutput['intended_moment']][] = [
    [`${name.split(' ')[0] || 'Hello'} speaking.`, 'opener'],
    [cold ? "...what's this regarding?" : "Oh sure, what's this regarding?", 'whats_this_regarding'],
    [objection, 'objection_broker'],
    ['How much would something like that cost?', 'buying_signal'],
    [cold ? "Fine, send me an invite. I'm busy though." : 'Sure, Thursday works.', 'close'],
  ];
  const i = Math.min(prospectTurns, script.length - 1);
  const [reply, intended] = script[i]!;
  const mood: Receptivity = i >= 3 && !cold ? 'warm' : p.mood;
  const last = i === script.length - 1;
  return { reply, intended_moment: intended, mood_now: mood, ends_call: last, books_meeting: last && p.mood !== 'cold' };
}
