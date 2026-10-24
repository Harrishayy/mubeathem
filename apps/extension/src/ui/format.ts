import { OUTCOME_LABEL, type Outcome } from '@cue/core';

/** "today", "yesterday", "3 days ago", "2 weeks ago", then the date. */
export function ago(at: number, now = Date.now()): string {
  const day = 86_400_000;
  const startOf = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((startOf(now) - startOf(at)) / day);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A stored outcome string in words ("Meeting booked"); unknown codes read as themselves. */
export function outcomeWords(o: string | null | undefined): string | null {
  if (!o) return null;
  return o in OUTCOME_LABEL ? OUTCOME_LABEL[o as Outcome] : o.replace(/_/g, ' ');
}

/** "Title · Company", or null when neither is known. */
export function role(p: { title?: string; company?: string }): string | null {
  return [p.title, p.company].filter((x) => x && x.trim()).join(' · ') || null;
}
