import type { Turn } from '@cue/core';
import type { SessionDetail } from './requests';
import { secondsToMs } from './time';

export type RowObject = Record<string, unknown>;

/** session-list-v6 rows are positional: cell i is `select[i]`. Short rows leave columns undefined. */
export function rowsToObjects(select: readonly string[], rows: readonly unknown[]): RowObject[] {
  return rows.map((row, r) => {
    if (!Array.isArray(row)) throw new TypeError(`Trellus row ${r} is not an array`);
    const obj: RowObject = {};
    select.forEach((column, i) => {
      obj[column] = row[i];
    });
    return obj;
  });
}

export const TRANSCRIPT_COLUMNS = ['turn_data.texts', 'turn_data.is_customers', 'turn_data.starts', 'turn_data.ends'] as const;

interface AlignedTurns {
  texts: unknown;
  isCustomers: unknown;
  starts: unknown;
  ends?: unknown;
}

/**
 * Combine the aligned transcript arrays into Cue turns. `true` in `is_customers` is the prospect.
 * Offsets are seconds from session start. Empty (redacted) utterances are dropped; ids are stable
 * per session and index so a re-import produces the same turns.
 */
function alignTurns(a: AlignedTurns, sessionId: string): Turn[] {
  const texts = asArray(a.texts);
  const who = asArray(a.isCustomers);
  const starts = asArray(a.starts);
  const ends = asArray(a.ends);
  const n = Math.min(texts.length, who.length);
  const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'session';
  const turns: Turn[] = [];
  let lastMs = 0;
  for (let i = 0; i < n; i++) {
    const text = typeof texts[i] === 'string' ? (texts[i] as string).trim() : '';
    if (!text) continue;
    const startS = toNumber(starts[i]);
    const tMs = startS === null ? lastMs : Math.max(0, secondsToMs(startS));
    const endS = toNumber(ends[i]);
    const durMs = endS !== null && startS !== null && endS >= startS ? secondsToMs(endS - startS) : undefined;
    lastMs = tMs;
    turns.push({
      id: `turn_${safeId}_${i}`,
      speaker: who[i] === true ? 'prospect' : 'rep',
      text: text.slice(0, 4000),
      tMs,
      ...(durMs !== undefined ? { durMs } : {}),
      final: true,
      via: 'trellus',
    });
  }
  // Offsets should already ascend; a stable sort guards against out-of-order cells.
  return turns.map((t, i) => [t, i] as const).sort((x, y) => x[0].tMs - y[0].tMs || x[1] - y[1]).map(([t]) => t);
}

/** Turns from a session-list row object (snake_case paths). */
export function transcriptFromRow(obj: RowObject): Turn[] {
  return alignTurns(
    { texts: obj['turn_data.texts'], isCustomers: obj['turn_data.is_customers'], starts: obj['turn_data.starts'], ends: obj['turn_data.ends'] },
    String(obj.session_id ?? ''),
  );
}

/** Turns from a `/session` proto-JSON detail (camelCase). */
export function transcriptFromSession(detail: SessionDetail): Turn[] {
  const td = detail.turnData ?? {};
  return alignTurns({ texts: td.texts, isCustomers: td.isCustomers, starts: td.starts, ends: td.ends }, detail.sessionId);
}

/** `customer_data.custom_fields` and `state` are JSON text in list rows. Bad JSON → {}. */
export function parseJsonText(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
