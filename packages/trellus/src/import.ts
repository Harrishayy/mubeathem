import type { CallEventInput } from '@cue/core';
import type { ImportedCall } from './source';

/**
 * A past call as Cue events: `call.started` (source `import`), each turn, `call.ended`, then the
 * Trellus outcome with raw strings kept. `at` is set from the call's own timeline so the store's
 * stamps stay monotonic; the store adds `seq`.
 */
export function importedCallToEvents(c: ImportedCall, ids: { newId: (prefix: string) => string }): CallEventInput[] {
  const callId = ids.newId('call');
  const lastTurnEnd = c.turns.reduce((m, t) => Math.max(m, t.tMs + (t.durMs ?? 0)), 0);
  const durationMs = Math.max(0, Math.round(c.durationMs), lastTurnEnd);
  const endAt = c.startedAt + durationMs;

  const events: CallEventInput[] = [
    {
      type: 'call.started',
      callId,
      at: c.startedAt,
      source: 'import',
      prospect: c.prospect,
      rep: c.rep,
      ...(c.trellusSessionId ? { trellusSessionId: c.trellusSessionId.slice(0, 120) } : {}),
    },
  ];
  for (const turn of [...c.turns].sort((a, b) => a.tMs - b.tMs)) {
    events.push({ type: 'turn.added', callId, at: c.startedAt + turn.tMs, turn: { ...turn, id: ids.newId('turn'), final: true } });
  }
  events.push({ type: 'call.ended', callId, at: endAt, durationMs });
  if (c.outcome) {
    events.push({ type: 'outcome.recorded', callId, at: Math.max(endAt, c.outcome.at), outcome: { ...c.outcome, source: 'trellus' } });
  }
  return events;
}
