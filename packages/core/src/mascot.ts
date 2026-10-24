import type { CallView } from './schema/api';

/** Sprout's states, in the UI's words. */
export type MascotState = 'idle' | 'listening' | 'thinking' | 'suggesting' | 'warning' | 'celebrating' | 'learning' | 'offline';

/** A violation flag keeps Sprout on `warning` this long. */
export const WARNING_MS = 8_000;
/** A fresh card keeps Sprout on `suggesting` this long. */
export const SUGGESTING_MS = 6_000;

/** The view's "now": its latest event time, else the newest time it holds. Never the wall clock. */
function viewNow(v: CallView): number {
  if (v.updatedAt !== undefined) return v.updatedAt;
  let t = Math.max(v.startedAt, v.endedAt ?? 0, v.current?.createdAt ?? 0);
  for (const f of v.flags) t = Math.max(t, f.at ?? 0);
  return t;
}

/**
 * Sprout's state for a view. Offline beats everything, then: a violation flag in the last 8 s →
 * warning; booked → celebrating; reviewing → learning; pending → thinking; a card under 6 s old →
 * suggesting; live → listening; else idle. `reconnecting` keeps the view's state (the UI shows its own pill).
 */
export function mascotFor(view: CallView | null, conn: 'live' | 'reconnecting' | 'offline' = 'live'): MascotState {
  if (conn === 'offline') return 'offline';
  if (!view) return 'idle';
  const now = viewNow(view);

  const newest = view.flags[view.flags.length - 1];
  if (newest && newest.verdict === 'violation' && newest.at !== undefined && now - newest.at < WARNING_MS) return 'warning';
  if (view.outcome?.outcome === 'meeting_booked') return 'celebrating';
  if (view.status === 'reviewing') return 'learning';
  if (view.pending) return 'thinking';
  if (view.current && now - view.current.createdAt < SUGGESTING_MS) return 'suggesting';
  if (view.status === 'live') return 'listening';
  return 'idle';
}
