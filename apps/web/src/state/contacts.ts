import type { Contact } from '@cue/core';
import { navigate } from '../router';
import { getApi } from './api';
import { startCall } from './call';
import { settingsStore } from './settings';

/** Who is calling: the rep from Settings (a placeholder until they add their name). */
export function currentRep(): { id: string; name: string } {
  const s = settingsStore.get();
  return { id: s.repId || 'rep_you', name: s.repName.trim() || 'You' };
}

const warmed = new Map<string, number>();
const WARM_EVERY_MS = 5 * 60_000;

/**
 * Starts Exa/Valyu research on a contact as soon as the rep looks at them, so the brief is ready when
 * the call starts. Fire and forget: failures are ignored, and the same contact isn't re-warmed for 5 min.
 */
export function warmResearch(contactId: string): void {
  const now = Date.now();
  if ((warmed.get(contactId) ?? 0) > now - WARM_EVERY_MS) return;
  warmed.set(contactId, now);
  getApi()
    .warmResearch({ contactId })
    .catch(() => warmed.delete(contactId));
}

/** Start a live call to a saved contact and go to Live. */
export async function callContact(c: Pick<Contact, 'id'>): Promise<void> {
  await startCall({ source: 'cue', contactId: c.id, prospect: {}, rep: currentRep() });
  navigate({ name: 'live' });
}

const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "Today, 3:05 PM" · "Yesterday" · "Mar 12, 2026". */
export function whenLabel(t: number, now = Date.now()): string {
  const d = new Date(t);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (diffDays <= 0) return `Today, ${TIME.format(d)}`;
  if (diffDays === 1) return `Yesterday, ${TIME.format(d)}`;
  return DAY.format(d);
}
