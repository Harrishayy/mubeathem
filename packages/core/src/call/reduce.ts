import type { CallView } from '../schema/api';
import type { OutcomeRecord, Turn } from '../schema/domain';
import type { CallEvent } from '../schema/events';

/** Turns kept in a live view. The CallRecord keeps every turn. */
export const VIEW_TURN_CAP = 200;
/** Cards kept in a live view's history. */
export const VIEW_HISTORY_CAP = 200;

/** Higher wins: a HubSpot meeting beats a Trellus disposition beats the rep's tap beats the review's guess. */
const OUTCOME_TRUST: Record<OutcomeRecord['source'], number> = { review: 0, rep: 1, trellus: 2, hubspot: 3 };

export interface ReduceOptions {
  /** Max turns kept; `Infinity` for the full transcript. */
  maxTurns?: number;
}

/** A blank view for a call before any event has arrived. */
export function emptyView(callId: string): CallView {
  return {
    id: callId,
    status: 'live',
    source: 'cue',
    startedAt: 0,
    endedAt: null,
    prospect: { name: '', title: '', company: '', facts: {} },
    rep: { id: 'rep_unknown', name: '' },
    brief: null,
    turns: [],
    situation: null,
    current: null,
    history: [],
    flags: [],
    receptivityTrend: [],
    outcome: null,
    feedback: null,
    review: null,
    pending: false,
    lastError: null,
    lastSeq: 0,
  };
}

function latestFinalProspectTurnId(turns: Turn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (t.speaker === 'prospect' && t.final) return t.id;
  }
  return null;
}

function upsertTurn(turns: Turn[], turn: Turn, cap: number): Turn[] | null {
  const idx = turns.findIndex((t) => t.id === turn.id);
  if (idx >= 0) {
    const existing = turns[idx]!;
    // Interim after final is a late echo from the transcriber; the final text stands.
    if (existing.final && !turn.final) return null;
    const next = turns.slice();
    next[idx] = turn;
    return next;
  }
  // Insert in time order so a late-arriving turn lands where it was spoken.
  let at = turns.length;
  while (at > 0 && turns[at - 1]!.tMs > turn.tMs) at--;
  const next = turns.slice(0, at).concat(turn, turns.slice(at));
  return next.length > cap ? next.slice(next.length - cap) : next;
}

function applyWith(view: CallView, e: CallEvent, cap: number): CallView {
  if (e.callId !== view.id) return view;
  // Replays and duplicate deliveries carry a seq we've already applied.
  if (e.seq > 0 && e.seq <= view.lastSeq) return view;

  const v: CallView = { ...view, lastSeq: Math.max(view.lastSeq, e.seq), updatedAt: Math.max(view.updatedAt ?? 0, e.at) };

  switch (e.type) {
    case 'call.started':
      v.status = 'live';
      v.source = e.source;
      v.startedAt = e.at;
      v.prospect = e.prospect;
      v.rep = e.rep;
      return v;

    case 'brief.ready':
      v.brief = e.brief;
      return v;

    case 'turn.added': {
      const turns = upsertTurn(v.turns, e.turn, cap);
      if (!turns) return { ...view, lastSeq: v.lastSeq, updatedAt: v.updatedAt };
      v.turns = turns;
      if (e.turn.final && e.turn.speaker === 'prospect' && v.status === 'live') v.pending = true;
      return v;
    }

    case 'situation.read': {
      v.situation = e.situation;
      const turn = v.turns.find((t) => t.id === e.turnId);
      const tMs = turn ? turn.tMs : Math.max(0, e.at - v.startedAt);
      v.receptivityTrend = [...v.receptivityTrend, { tMs, score: e.situation.receptivityScore }];
      if (e.turnId === latestFinalProspectTurnId(v.turns)) v.pending = false;
      return v;
    }

    case 'suggestion.skipped':
      if (e.turnId === latestFinalProspectTurnId(v.turns)) v.pending = false;
      return v;

    case 'suggestion.shown': {
      const s = e.suggestion;
      const idx = v.history.findIndex((h) => h.suggestion.id === s.id);
      if (idx >= 0) {
        v.history = v.history.slice();
        v.history[idx] = { suggestion: s, action: v.history[idx]!.action };
      } else {
        const history = [...v.history, { suggestion: s, action: null }];
        v.history = history.length > VIEW_HISTORY_CAP ? history.slice(history.length - VIEW_HISTORY_CAP) : history;
      }
      if (v.status === 'live') v.current = s;
      return v;
    }

    case 'suggestion.action': {
      const idx = v.history.findIndex((h) => h.suggestion.id === e.suggestionId);
      if (idx >= 0) {
        v.history = v.history.slice();
        v.history[idx] = { suggestion: v.history[idx]!.suggestion, action: e.action };
      }
      if (v.current?.id === e.suggestionId && (e.action === 'dismissed' || e.action === 'expired')) v.current = null;
      return v;
    }

    case 'policy.checked':
      v.flags = [...v.flags, { ...e.check, at: e.check.at ?? e.at }];
      return v;

    case 'call.ended':
      if (v.status === 'live') v.status = 'ended';
      v.endedAt = e.at;
      v.current = null;
      v.pending = false;
      return v;

    case 'outcome.recorded':
      if (!v.outcome || OUTCOME_TRUST[e.outcome.source] >= OUTCOME_TRUST[v.outcome.source]) v.outcome = e.outcome;
      return v;

    case 'feedback.submitted':
      v.feedback = e.feedback;
      if (v.status !== 'reviewed') v.status = 'reviewing';
      v.current = null;
      v.pending = false;
      if (!v.outcome) v.outcome = { outcome: e.feedback.outcome, source: 'rep', raw: {}, at: e.at };
      return v;

    case 'review.completed':
      v.review = e.review;
      v.status = 'reviewed';
      v.current = null;
      v.pending = false;
      if (!v.outcome) v.outcome = { outcome: e.review.outcome, source: 'review', raw: {}, at: e.at };
      return v;

    case 'playbook.updated':
      return v;

    case 'pipeline.error':
      v.lastError = { stage: e.stage, message: e.message };
      v.pending = false;
      return v;
  }
}

/** Applies one event to a view and returns a new view. Never mutates its input; ignores already-applied seqs. */
export function applyEvent(view: CallView, e: CallEvent): CallView {
  return applyWith(view, e, VIEW_TURN_CAP);
}

/** Stable sort by seq; unstamped (seq 0) events keep their position relative to each other. */
function ordered(events: CallEvent[]): CallEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.seq - b.e.seq || a.i - b.i)
    .map((x) => x.e);
}

/** Folds a call's event log (any order, duplicates allowed) into its view. */
export function reduceCall(events: CallEvent[], opts: ReduceOptions = {}): CallView {
  const cap = opts.maxTurns ?? VIEW_TURN_CAP;
  const list = ordered(events);
  const callId = list.find((e) => e.type === 'call.started')?.callId ?? list[0]?.callId ?? 'call_unknown';
  let view = emptyView(callId);
  for (const e of list) view = applyWith(view, e, cap);
  return view;
}
