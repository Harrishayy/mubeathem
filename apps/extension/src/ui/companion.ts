import { MOMENT_META, type CallSummary, type CallView, type Moment, type Prospect, type Turn } from '@cue/core';

/**
 * What the side panel shows, worked out from the call and the team's calls. Pure, so it is tested
 * without Chrome or a server.
 */

export type TranscriptRow =
  | { kind: 'moment'; key: string; moment: Moment; family: string }
  | { kind: 'turn'; key: string; turn: Turn; usedLine: boolean; latest: boolean };

/**
 * The transcript as the rep reads it: each prospect turn Cue answered gets the moment it read above
 * it, and the rep's next turn after a line they used gets a tick. Interim (still speaking) last.
 */
export function transcriptRows(view: CallView): TranscriptRow[] {
  const final = view.turns.filter((t) => t.final);
  const interim = view.turns.at(-1)?.final === false ? view.turns.at(-1)! : null;
  const momentAt = new Map<string, Moment>();
  const usedAfter = new Set<string>();
  for (const h of view.history) {
    if (!momentAt.has(h.suggestion.turnId)) momentAt.set(h.suggestion.turnId, h.suggestion.kind === 'compliance' ? 'compliance' : h.suggestion.situation.moment);
    if (h.action === 'used' || h.action === 'edited') usedAfter.add(h.suggestion.turnId);
  }
  const rows: TranscriptRow[] = [];
  let pendingTick = false;
  const all = interim && !final.some((t) => t.id === interim.id) ? [...final, interim] : final;
  const lastProspect = [...all].reverse().find((t) => t.speaker === 'prospect');
  for (const t of all) {
    const m = momentAt.get(t.id);
    if (m) rows.push({ kind: 'moment', key: `m_${t.id}`, moment: m, family: MOMENT_META[m].family });
    const usedLine = t.speaker === 'rep' && pendingTick && t.final;
    if (t.speaker === 'rep' && t.final) pendingTick = false;
    rows.push({ kind: 'turn', key: t.id, turn: t, usedLine, latest: t === lastProspect && view.status === 'live' });
    if (t.speaker === 'prospect' && usedAfter.has(t.id)) pendingTick = true;
  }
  return rows;
}

const wordsIn = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The rep's share of the words said, 0..1; null before anyone has spoken. */
export function talkShare(view: CallView): number | null {
  let rep = 0;
  let all = 0;
  for (const t of view.turns) {
    if (!t.final) continue;
    const n = wordsIn(t.text);
    all += n;
    if (t.speaker === 'rep') rep += n;
  }
  return all ? rep / all : null;
}

/** "lumenlabs.ai" from a URL, for the line under a source. */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const CONNECTED_OUTCOMES = new Set(['meeting_booked', 'follow_up', 'not_interested', 'callback_requested', 'wrong_person', 'gatekeeper_blocked']);

export interface HourBucket {
  hour: number;
  calls: number;
  connected: number;
  rate: number;
}

/**
 * When the team gets people on the phone: connect rate by hour of day (rep's local time), 8 am to
 * 6 pm. Null until there are enough calls to say anything (at least `min` with an outcome).
 */
export function bestHours(calls: CallSummary[], min = 12): { buckets: HourBucket[]; best: HourBucket } | null {
  const buckets: HourBucket[] = Array.from({ length: 10 }, (_, i) => ({ hour: 8 + i, calls: 0, connected: 0, rate: 0 }));
  let counted = 0;
  for (const c of calls) {
    if (!c.outcome || c.outcome === 'unknown') continue;
    const h = new Date(c.startedAt).getHours();
    const b = buckets[h - 8];
    if (!b) continue;
    b.calls++;
    counted++;
    if (CONNECTED_OUTCOMES.has(c.outcome)) b.connected++;
  }
  if (counted < min) return null;
  for (const b of buckets) b.rate = b.calls ? b.connected / b.calls : 0;
  const best = buckets.reduce((a, b) => (b.calls >= 2 && b.rate > a.rate ? b : a), buckets.find((b) => b.calls > 0) ?? buckets[0]!);
  return { buckets, best };
}

export function hourWords(h: number): string {
  const f = (x: number) => `${((x + 11) % 12) + 1}${x < 12 ? ' am' : ' pm'}`;
  return `${f(h)} to ${f(h + 1)}`;
}

const norm = (s: string | undefined | null) => (s ?? '').trim().toLowerCase();

/**
 * The team's previous calls with this person: the saved contact's calls when there is one, else calls
 * whose name matches (and company, when both are known). Newest first, without `excludeId`.
 */
export function pastCallsFor(calls: CallSummary[], p: Pick<Prospect, 'name' | 'company'>, contactId?: string | null, excludeId?: string | null): CallSummary[] {
  return calls
    .filter((c) => c.id !== excludeId)
    .filter((c) => (contactId && c.contactId === contactId) || (norm(c.prospect.name) === norm(p.name) && (!norm(p.company) || !norm(c.prospect.company) || norm(c.prospect.company) === norm(p.company))))
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** The order of moments the call went through (one entry per card shown), for the wrap-up strip. */
export function momentStrip(view: CallView): { moment: Moment; family: string; label: string }[] {
  const out: { moment: Moment; family: string; label: string }[] = [];
  for (const h of view.history) {
    const m = h.suggestion.kind === 'compliance' ? 'compliance' : h.suggestion.situation.moment;
    if (out.at(-1)?.moment === m) continue;
    out.push({ moment: m, family: MOMENT_META[m].family, label: MOMENT_META[m].short });
  }
  return out;
}

/** Receptivity at the start and the end of the call, as words ("Cooling → Warm"). */
export function moodArc(view: CallView): { from: number; to: number } | null {
  const t = view.receptivityTrend;
  if (t.length < 2) return null;
  return { from: t[0]!.score, to: t.at(-1)!.score };
}

/** The key of a prospect, for "is this still the same person". */
export function prospectKey(p: Pick<Prospect, 'name' | 'company' | 'phone'> | null | undefined): string {
  if (!p) return '';
  return [p.name, p.company, (p.phone ?? '').replace(/\D/g, '')].map(norm).join('|');
}
