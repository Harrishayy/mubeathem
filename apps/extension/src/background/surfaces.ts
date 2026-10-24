import { OUTCOME_LABEL, type CallView } from '@cue/core';
import type { SessionState } from '../messages';

/**
 * Cue outside the side panel: the toolbar badge, and the one notification worth an interruption (the
 * outcome Trellus logged after the call). Pure functions here; background.ts applies them.
 */

export interface Badge {
  text: string;
  color: string;
  title: string;
}

const GREEN = '#2c6a45';
const AMBER = '#c66b04';
const BLUE = '#2b5c8a';

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Live: the call timer, or "!" while a claim needs checking. Ended: a tick when it booked. Before a call: how many hooks the brief has. */
export function badgeFor(state: SessionState, now: number, briefHooks = 0): Badge {
  const view = state.view;
  if (state.phase === 'live' || state.phase === 'starting') {
    if (view?.current?.kind === 'compliance') return { text: '!', color: AMBER, title: 'Cue: check that claim before you repeat it' };
    return { text: view ? clock(now - view.startedAt) : '…', color: GREEN, title: view ? `Cue: on a call with ${view.prospect.name || 'the prospect'}` : 'Cue: starting' };
  }
  if (state.phase === 'ended') {
    const o = view?.outcome?.outcome;
    return o === 'meeting_booked' ? { text: '✓', color: GREEN, title: 'Cue: meeting booked' } : { text: '', color: GREEN, title: 'Cue: call ended' };
  }
  if (briefHooks > 0 && state.page?.prospect) return { text: String(briefHooks), color: BLUE, title: `Cue: ${briefHooks} reasons to call ${state.page.prospect.name || 'them'} now` };
  return { text: '', color: GREEN, title: 'Open Cue' };
}

export interface OutcomeNote {
  id: string;
  title: string;
  message: string;
}

/**
 * The outcome Trellus (or HubSpot) logged after the call, once per call. The rep's own tap needs no
 * notification: they just made it.
 */
export function outcomeNote(prev: CallView | null | undefined, next: CallView | null | undefined, told: Set<string>): OutcomeNote | null {
  const o = next?.outcome;
  if (!next || !o || o.source === 'rep' || o.source === 'review' || told.has(next.id)) return null;
  if (prev?.id === next.id && prev.outcome?.outcome === o.outcome && prev.outcome.source === o.source) return null;
  told.add(next.id);
  const who = next.prospect.name || next.prospect.company || 'your last call';
  return {
    id: `cue-outcome-${next.id}`,
    title: `${OUTCOME_LABEL[o.outcome]} · ${who}`,
    message: `${o.source === 'trellus' ? 'Trellus' : 'HubSpot'} logged this. Confirm it in Cue so it counts toward what works.`,
  };
}

/** Omnibox suggestions are XML: escape what came from the server. */
export function xml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}
