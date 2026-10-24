import type { CallEvent, CallEventInput } from '../schema/events';
import type { Situation, Suggestion, Turn, TurnFeatures } from '../schema/domain';

export const CALL = 'call_test';

/** An unstamped event without its callId; distributes over the union so each member keeps its fields. */
type Input = CallEventInput extends infer U ? (U extends unknown ? Omit<U, 'callId'> : never) : never;
export const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

/** Builds a stamped event log: each push gets the next seq; `at` defaults to T0 + seq seconds. */
export function log() {
  const events: CallEvent[] = [];
  let seq = 0;
  return {
    events,
    push(e: Input) {
      seq++;
      const ev = { callId: CALL, ...e, at: e.at ?? T0 + seq * 1000, seq } as CallEvent;
      events.push(ev);
      return ev;
    },
  };
}

export function turn(id: string, speaker: Turn['speaker'], text: string, tMs: number, extra: Partial<Turn> = {}): Turn {
  return { id, speaker, text, tMs, final: true, via: 'typed', ...extra };
}

export function situation(over: Partial<Situation> = {}): Situation {
  return {
    persona: 'ceo',
    personaConfidence: 0.8,
    receptivity: 'neutral',
    receptivityScore: 0.2,
    moment: 'objection_broker',
    momentConfidence: 0.8,
    tone: { engagement: 0.5, warmth: 0.5, patience: 0.5, interest: 0.5 },
    signals: [],
    shouldSuggest: true,
    rationale: 'test',
    ...over,
  };
}

export function suggestion(id: string, turnId: string, createdAt: number, over: Partial<Suggestion> = {}): Suggestion {
  return {
    id,
    callId: CALL,
    turnId,
    situation: situation(),
    say: 'Makes sense, most founders do. When did they last re-quote you after a raise?',
    why: 'test',
    lineId: 'line_seed_br_requote',
    evidence: { text: 'x', calls: 0, basis: 'model' },
    upNext: [],
    kind: 'line',
    createdAt,
    latencyMs: 900,
    servedBy: 'rules',
    mubitRequestIds: [],
    ...over,
  };
}

export const features: TurnFeatures = {
  turnIndex: 0,
  prospectWords: 3,
  repWords: 3,
  prospectShare: 0.5,
  shareTrend: 0,
  interrupted: false,
  questionsAsked: 0,
  elapsedMs: 1000,
};

export function started(l: ReturnType<typeof log>) {
  return l.push({
    type: 'call.started',
    at: T0,
    source: 'cue',
    prospect: { name: 'Maya Chen', title: 'CEO', company: 'Lumen Labs', facts: {} },
    rep: { id: 'rep_1', name: 'Alex' },
  });
}
