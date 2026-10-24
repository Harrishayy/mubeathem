import type { Outcome, OutcomeRecord, Prospect, Rep } from '@cue/core';
import type { TrellusClient } from './client';
import { buildDispositionMap, mapDisposition, type DispositionMap } from './dispositions';
import { normalisePhone, phonesMatch } from './phone';
import { CALLS_ONLY, CONNECTED_CALLS } from './requests';
import { parseJsonText, rowsToObjects, str, toNumber, transcriptFromRow, TRANSCRIPT_COLUMNS, type RowObject } from './rows';
import type { CallSource, FindOutcomeQuery, ImportedCall } from './source';
import { msToMicros, secondsToMs } from './time';
import { listSessionsSplitting } from './windows';

export const MATCH_WINDOW_MS = 10 * 60 * 1000;

/** Columns for outcome matching. All documented paths. */
export const OUTCOME_SELECT = [
  'session_id',
  'started_at',
  'resource_id',
  'customer_address',
  'customer_data.name',
  'customer_data.company_name',
  'duration',
  'dial_metric.live_duration',
  'is_provisional',
  'user_log.disposition',
  'user_log.sentiment',
  'user_log.purpose',
  'user_log.notes',
  'user_log.source',
] as const;

/** Columns for importing history, with the transcript. */
export const IMPORT_SELECT = [
  ...OUTCOME_SELECT,
  'customer_data.title',
  'customer_data.company_url',
  'customer_data.custom_fields',
  'dial_metric.has_voicemail',
  'sales_metric.has_gatekeeper',
  'sales_metric.has_meeting_confirm',
  'platform',
  ...TRANSCRIPT_COLUMNS,
] as const;

export interface TrellusSourceOptions {
  client: TrellusClient;
  /** A fixed map, or omit to learn the account's labels from /bootstrap on first use. */
  dispositions?: DispositionMap;
  /** Manual mappings from settings; applied on top of the learned map. */
  overrides?: Record<string, Outcome>;
  now?: () => number;
  matchWindowMs?: number;
}

export class TrellusSource implements CallSource {
  readonly kind = 'trellus' as const;
  private readonly client: TrellusClient;
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly overrides: Record<string, Outcome>;
  private dispositions: DispositionMap | null;
  private repNames: Map<string, string> | null = null;

  constructor(opts: TrellusSourceOptions) {
    this.client = opts.client;
    this.now = opts.now ?? Date.now;
    this.windowMs = opts.matchWindowMs ?? MATCH_WINDOW_MS;
    this.overrides = opts.overrides ?? {};
    this.dispositions = opts.dispositions ?? null;
  }

  /** The account's map; falls back to the defaults (not cached) if /bootstrap fails. */
  async dispositionMap(): Promise<DispositionMap> {
    if (this.dispositions) return this.dispositions;
    try {
      this.dispositions = buildDispositionMap(await this.client.bootstrap(), this.overrides);
      return this.dispositions;
    } catch {
      return buildDispositionMap(null, this.overrides);
    }
  }

  /** Forget the learned map and directory, e.g. after the settings change. */
  refresh(): void {
    this.dispositions = null;
    this.repNames = null;
  }

  async findOutcome(q: FindOutcomeQuery): Promise<OutcomeRecord | null> {
    const select = [...OUTCOME_SELECT];
    const start = msToMicros(q.startedAt - this.windowMs);
    // Nothing can have started after now; the end is exclusive.
    const end = Math.max(start + 1, msToMicros(Math.min(this.now(), q.startedAt + this.windowMs) + 1));
    const rows = await this.client.sessionList({
      start,
      end,
      cnf: CALLS_ONLY,
      select,
      limit: 200,
    });
    const best = pickMatch(rowsToObjects(select, rows), q, this.windowMs);
    if (!best) return null;
    const disposition = str(best['user_log.disposition']).trim();
    // An unset disposition is an empty string: the rep has not dispositioned yet.
    if (!disposition) return null;
    return {
      outcome: mapDisposition(disposition, await this.dispositionMap()),
      source: 'trellus',
      raw: rawStrings(best),
      at: this.now(),
    };
  }

  async listRecent(q: { since: number; limit?: number }): Promise<ImportedCall[]> {
    const limit = Math.max(1, Math.min(q.limit ?? 200, 10_000));
    const select = [...IMPORT_SELECT];
    const base = { start: msToMicros(q.since), end: msToMicros(this.now()) + 1, cnf: CONNECTED_CALLS, select };
    const rows =
      limit <= 1000
        ? await this.client.sessionList({ ...base, limit })
        : (await listSessionsSplitting(this.client, { ...base, limit: 1000 })).rows.slice(0, limit);
    const [map, names] = await Promise.all([this.dispositionMap(), this.directory()]);
    const at = this.now();
    return rowsToObjects(select, rows).map((obj) => toImportedCall(obj, map, names, at));
  }

  private async directory(): Promise<Map<string, string>> {
    if (this.repNames) return this.repNames;
    try {
      const dir = await this.client.visible();
      this.repNames = new Map(dir.users.map((u) => [u.user_id, u.user_name || dir.user_id_to_email[u.user_id] || u.user_id]));
    } catch {
      return new Map();
    }
    return this.repNames;
  }
}

/**
 * Phone first (normalised), else name + company (company required to agree when both sides have
 * one), within ±window of the start. Ties go to the longest live portion, then the closest start.
 */
export function pickMatch(rows: RowObject[], q: FindOutcomeQuery, windowMs = MATCH_WINDOW_MS): RowObject | null {
  const inWindow = rows.filter((r) => {
    const s = toNumber(r.started_at);
    return s !== null && Math.abs(secondsToMs(s) - q.startedAt) <= windowMs;
  });
  let candidates: RowObject[] = [];
  if (normalisePhone(q.prospect.phone)) candidates = inWindow.filter((r) => phonesMatch(str(r.customer_address), q.prospect.phone));
  if (!candidates.length) {
    const name = normaliseName(q.prospect.name);
    const company = normaliseCompany(q.prospect.company);
    if (name) {
      candidates = inWindow.filter((r) => {
        if (normaliseName(str(r['customer_data.name'])) !== name) return false;
        const rc = normaliseCompany(str(r['customer_data.company_name']));
        return !company || !rc || rc === company;
      });
    }
  }
  if (!candidates.length) return null;
  const live = (r: RowObject) => toNumber(r['dial_metric.live_duration']) ?? 0;
  const gap = (r: RowObject) => Math.abs(secondsToMs(toNumber(r.started_at) ?? 0) - q.startedAt);
  return [...candidates].sort((a, b) => live(b) - live(a) || gap(a) - gap(b))[0] ?? null;
}

export function normaliseName(s: string | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

const COMPANY_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|pbc|sa|ag|bv|labs?|hq)\b/g;
export function normaliseCompany(s: string | undefined): string {
  return normaliseName(s).replace(COMPANY_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}

/** OutcomeRecord.raw keeps Trellus strings verbatim; numbers become strings, empties are dropped. */
function rawStrings(obj: RowObject): Record<string, string> {
  const keep = ['session_id', 'user_log.disposition', 'user_log.sentiment', 'user_log.purpose', 'user_log.notes', 'user_log.source'];
  const out: Record<string, string> = {};
  for (const k of keep) {
    const v = obj[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = String(v);
  }
  return out;
}

export function toImportedCall(obj: RowObject, map: DispositionMap, repNames: Map<string, string>, at: number): ImportedCall {
  const sessionId = str(obj.session_id);
  const custom = parseJsonText(obj['customer_data.custom_fields']);
  const facts: Record<string, string> = {};
  for (const [k, v] of Object.entries(custom)) {
    if ((typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && String(v).length <= 500 && !/email/i.test(k)) facts[k] = String(v);
  }
  const url = str(obj['customer_data.company_url']);
  if (url) facts.company_url = url;
  const emailKey = Object.keys(custom).find((k) => /e-?mail/i.test(k) && typeof custom[k] === 'string');
  const phone = str(obj.customer_address).trim();
  const prospect: Prospect = {
    name: str(obj['customer_data.name']).slice(0, 200),
    title: str(obj['customer_data.title']).slice(0, 200),
    company: str(obj['customer_data.company_name']).slice(0, 200),
    ...(phone ? { phone: phone.slice(0, 40) } : {}),
    ...(emailKey ? { email: String(custom[emailKey]).slice(0, 200) } : {}),
    facts,
  };
  const repId = str(obj.resource_id) || 'trellus_unknown';
  const rep: Rep = { id: repId, name: (repNames.get(repId) ?? repId).slice(0, 120) };
  const turns = transcriptFromRow(obj);
  const disposition = str(obj['user_log.disposition']).trim();
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!k.startsWith('turn_data.')) raw[k] = v;
  const durationS = toNumber(obj.duration) ?? 0;
  const lastTurnEnd = turns.reduce((m, t) => Math.max(m, t.tMs + (t.durMs ?? 0)), 0);
  return {
    trellusSessionId: sessionId,
    startedAt: secondsToMs(toNumber(obj.started_at) ?? 0),
    durationMs: Math.max(secondsToMs(durationS), lastTurnEnd),
    prospect,
    rep,
    turns,
    outcome: disposition ? { outcome: mapDisposition(disposition, map), source: 'trellus', raw: rawStrings(obj), at } : null,
    raw,
  };
}

