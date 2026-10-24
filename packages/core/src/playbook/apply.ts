import type { Outcome } from '../taxonomy';
import type { LineStats, PlaybookLine } from '../schema/domain';
import type { CallRecord, CallReview } from '../schema/tasks';
import { newId } from '../ids';
import { findRiskyClaims } from '../policy/rules';
import { hashString, seededRng } from '../text';
import { TOTAL_KEY } from './bandit';
import { lineSimilarity } from './similarity';

/** A candidate this similar to an existing line (or an earlier candidate) is a duplicate. */
export const DUPLICATE_SIMILARITY = 0.8;

/** Outcomes that count as a lost call for the `lost` stat. Follow-ups and callbacks are still alive. */
const LOST_OUTCOMES: ReadonlySet<Outcome> = new Set(['not_interested', 'gatekeeper_blocked', 'wrong_person']);

function bump(st: LineStats | undefined, d: LineStats): LineStats {
  const s = st ?? { shown: 0, used: 0, stepWins: 0, booked: 0, lost: 0 };
  return { shown: s.shown + d.shown, used: s.used + d.used, stepWins: s.stepWins + d.stepWins, booked: s.booked + d.booked, lost: s.lost + d.lost };
}

function styleOf(text: string): string {
  return text.trim().endsWith('?') ? 'question' : 'straight';
}

/**
 * Folds one reviewed call into the playbook. Every line-card shown adds to its line's stats under its
 * situation key and `*`: shown, used (per the review, else the record), step win and booked (only
 * when used; a booking credits every used line), lost. Candidate lines from the review join as
 * `status: 'candidate'` unless they duplicate a line (similarity ≥ 0.8) or trip the claim pre-filter.
 * Pure: returns new arrays, never mutates its inputs.
 */
export function applyReview(
  lines: PlaybookLine[],
  record: CallRecord,
  review: CallReview,
  opts: { now: number },
): { lines: PlaybookLine[]; changed: string[]; candidates: PlaybookLine[] } {
  const outcome: Outcome = record.outcome?.outcome && record.outcome.outcome !== 'unknown' ? record.outcome.outcome : review.outcome;
  const booked = outcome === 'meeting_booked';
  const lost = LOST_OUTCOMES.has(outcome);
  const verdicts = new Map(review.linesUsed.map((u) => [u.suggestionId, u]));

  const byId = new Map(lines.map((l) => [l.id, l]));
  const changed: string[] = [];

  for (const s of record.suggestions) {
    if (s.kind !== 'line') continue;
    const target = byId.get(s.lineId);
    if (!target) continue;
    const v = verdicts.get(s.id);
    const used = v?.used ?? s.used ?? false;
    const win = used && ((v?.stepWin ?? s.stepWin ?? false) || booked);
    const d: LineStats = { shown: 1, used: used ? 1 : 0, stepWins: win ? 1 : 0, booked: used && booked ? 1 : 0, lost: used && lost ? 1 : 0 };
    const next = { ...target.stats, [s.situationKey]: bump(target.stats[s.situationKey], d), [TOTAL_KEY]: bump(target.stats[TOTAL_KEY], d) };
    byId.set(target.id, { ...target, stats: next });
    if (!changed.includes(target.id)) changed.push(target.id);
  }

  const updated = lines.map((l) => byId.get(l.id) ?? l);
  const candidates: PlaybookLine[] = [];
  const seen = updated.map((l) => l.text);

  for (const c of review.candidateLines) {
    const text = c.text.trim().slice(0, 400);
    if (!text) continue;
    if (seen.some((t) => lineSimilarity(t, text) >= DUPLICATE_SIMILARITY)) continue;
    if (findRiskyClaims(text).length > 0) continue;
    seen.push(text);
    const turn = c.turnId ?? undefined;
    candidates.push({
      // Deterministic for a given call, line and time, still time-sortable.
      id: newId('line', { now: opts.now, rng: seededRng(hashString(`${record.callId}|${text}`)) }),
      moment: c.moment,
      personas: [c.persona],
      receptivity: [c.receptivity],
      text,
      style: styleOf(text),
      products: [],
      status: 'candidate',
      origin: 'rep',
      createdAt: opts.now,
      stats: {},
      minedFrom: { callId: record.callId, ...(turn ? { turnId: turn } : {}), repId: record.rep.id, ...(record.rep.name ? { repName: record.rep.name } : {}) },
    });
  }

  return { lines: [...updated, ...candidates], changed, candidates };
}

