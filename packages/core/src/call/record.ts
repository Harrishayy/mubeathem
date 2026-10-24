import { situationKey } from '../taxonomy';
import type { Situation, TurnFeatures } from '../schema/domain';
import type { CallEvent } from '../schema/events';
import type { CallRecord } from '../schema/tasks';
import { reduceCall } from './reduce';

type SituationRead = Extract<CallEvent, { type: 'situation.read' }>;

/**
 * The structured record of one call, built from its event log: the full final transcript, one
 * situation per read prospect turn, every card with the rep's actions and the review's verdict,
 * policy checks, receptivity trend, outcome, debrief and Trellus fields. Parses as `CallRecord`.
 */
export function buildCallRecord(events: CallEvent[]): CallRecord {
  const view = reduceCall(events, { maxTurns: Infinity });
  const mine = events.filter((e) => e.callId === view.id).slice().sort((a, b) => a.seq - b.seq);
  const startedAt = view.startedAt;
  const rel = (at: number) => Math.max(0, at - startedAt);

  const ended = mine.filter((e) => e.type === 'call.ended').pop();
  const lastTurn = view.turns[view.turns.length - 1];
  const durationMs = ended?.type === 'call.ended' ? ended.durationMs : lastTurn ? lastTurn.tMs + (lastTurn.durMs ?? 0) : 0;

  const turnTime = new Map(view.turns.map((t) => [t.id, t.tMs]));

  // Last read per turn wins (a retry after a timeout replaces the rules read).
  const reads = new Map<string, SituationRead>();
  for (const e of mine) if (e.type === 'situation.read') reads.set(e.turnId, e);
  const situations = [...reads.values()]
    .map((e) => {
      const s: Situation = e.situation;
      const f: TurnFeatures = e.features;
      return {
        turnId: e.turnId,
        tMs: turnTime.get(e.turnId) ?? rel(e.at),
        persona: s.persona,
        receptivity: s.receptivity,
        receptivityScore: s.receptivityScore,
        moment: s.moment,
        tone: s.tone,
        signals: s.signals,
        features: f,
      };
    })
    .sort((a, b) => a.tMs - b.tMs);

  const shownAt = new Map<string, number>();
  const actions = new Map<string, CallRecord['suggestions'][number]['actions']>();
  for (const e of mine) {
    if (e.type === 'suggestion.shown' && !shownAt.has(e.suggestion.id)) shownAt.set(e.suggestion.id, e.at);
    if (e.type === 'suggestion.action') {
      const list = actions.get(e.suggestionId) ?? [];
      list.push({ action: e.action, text: e.text ?? null, atMs: rel(e.at) });
      actions.set(e.suggestionId, list);
    }
  }

  const verdicts = new Map((view.review?.linesUsed ?? []).map((u) => [u.suggestionId, u]));
  const suggestions = view.history.map(({ suggestion: s }) => {
    const acts = actions.get(s.id) ?? [];
    const v = verdicts.get(s.id);
    const tappedUsed = acts.some((a) => a.action === 'used' || a.action === 'edited');
    return {
      id: s.id,
      turnId: s.turnId,
      lineId: s.lineId,
      moment: s.situation.moment,
      situationKey: situationKey(s.situation),
      say: s.say,
      kind: s.kind,
      shownAtMs: rel(shownAt.get(s.id) ?? s.createdAt),
      latencyMs: s.latencyMs,
      servedBy: s.servedBy,
      actions: acts,
      used: v ? v.used : tappedUsed ? true : null,
      stepWin: v ? v.stepWin : null,
      mubitRequestIds: s.mubitRequestIds,
    };
  });

  const fb = view.feedback;
  const started = mine.find((e): e is Extract<CallEvent, { type: 'call.started' }> => e.type === 'call.started');
  const trellusSessionId = started?.trellusSessionId;
  const trellus =
    trellusSessionId || view.outcome?.source === 'trellus'
      ? { ...(trellusSessionId ? { sessionId: trellusSessionId } : {}), ...(view.outcome?.source === 'trellus' ? { disposition: view.outcome.raw } : {}) }
      : null;

  return {
    callId: view.id,
    source: view.source,
    startedAt,
    durationMs,
    prospect: { name: view.prospect.name, title: view.prospect.title, company: view.prospect.company, facts: view.prospect.facts },
    rep: { id: view.rep.id, name: view.rep.name, tenureDays: view.rep.tenureDays ?? null },
    transcript: view.turns.filter((t) => t.final !== false).map((t) => ({ id: t.id, speaker: t.speaker, text: t.text, tMs: t.tMs })),
    situations,
    suggestions,
    policyChecks: view.flags.map((c) => ({ claim: c.claim, verdict: c.verdict, speaker: c.speaker, rule: c.rule, via: c.via })),
    receptivityTrend: view.receptivityTrend,
    outcome: view.outcome ? { outcome: view.outcome.outcome, source: view.outcome.source, raw: view.outcome.raw } : null,
    feedback: fb
      ? {
          outcome: fb.outcome,
          rating: fb.rating ?? null,
          attitude: fb.attitude ?? null,
          whatWorked: fb.whatWorked ?? null,
          whatDidnt: fb.whatDidnt ?? null,
          betterLine: fb.betterLine ?? null,
          helpful: fb.helpful,
          unhelpful: fb.unhelpful,
          notes: fb.notes ?? null,
        }
      : null,
    trellus,
  };
}
