import { CallEvent, type CallEventInput, type CallListQuery, type CallSummary, type CallView, type CallStatus, type Prospect, type TeamMember, type TeamResponse } from '@cue/core';
import { applyEvent, emptyView, reduceCall } from '../adapters/core';
import { tx, type Db } from './db';

export type Listener = (e: CallEvent) => void;

export interface CallRow {
  id: string;
  status: CallStatus;
  source: string;
  startedAt: number;
  endedAt: number | null;
  prospect: Prospect;
  trellusSessionId: string | null;
  outcome: string | null;
  practice: PracticeState | null;
  hasFeedback: boolean;
  repId: string | null;
  contactId: string | null;
}

/** Practice/seed calls keep the simulated prospect's set-up and drifting mood. */
export interface PracticeState {
  mood: 'warm' | 'neutral' | 'cool' | 'cold';
  objections: string[];
  role?: string;
  ended?: boolean;
  booked?: boolean;
}

const VIEW_CACHE = 256;

/**
 * The call event log. `append` is the only way anything changes: it stamps `seq`/`at`, validates
 * with `CallEvent`, writes the row and the call's summary columns in one transaction, updates the
 * cached view, then notifies subscribers synchronously in seq order.
 */
export class EventStore {
  private listeners = new Map<string, Set<Listener>>();
  private views = new Map<string, CallView>();

  constructor(
    readonly db: Db,
    private now: () => number = Date.now,
  ) {}

  append(input: CallEventInput): CallEvent {
    const event = tx(this.db, () => {
      const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM events WHERE call_id = ?').get(input.callId) as { s: number };
      if (input.type !== 'call.started' && row.s === 0) throw new StoreError('not_found', `No call ${input.callId}`);
      if (input.type === 'call.started' && row.s > 0) throw new StoreError('conflict', `Call ${input.callId} already started`);
      const e = CallEvent.parse({ ...input, seq: row.s + 1, at: input.at ?? this.now() });
      this.db.prepare('INSERT INTO events (call_id, seq, type, at, json) VALUES (?, ?, ?, ?, ?)').run(e.callId, e.seq, e.type, e.at, JSON.stringify(e));
      this.project(e);
      return e;
    });
    const cached = this.views.get(event.callId);
    if (cached) this.cacheView(event.callId, applyEvent(cached, event));
    for (const fn of [...(this.listeners.get(event.callId) ?? [])]) {
      try {
        fn(event);
      } catch {
        // a broken subscriber never breaks the pipeline
      }
    }
    return event;
  }

  /** Keeps the `calls` table's summary columns in step with the log. */
  private project(e: CallEvent): void {
    const db = this.db;
    switch (e.type) {
      case 'call.started':
        db.prepare(
          'INSERT INTO calls (id, status, source, started_at, prospect_json, rep_json, trellus_session_id, rep_id, rep_name, contact_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(e.callId, 'live', e.source, e.at, JSON.stringify(e.prospect), JSON.stringify(e.rep), e.trellusSessionId ?? null, e.rep.id, e.rep.name, e.contactId ?? null);
        if (e.contactId) db.prepare('UPDATE contacts SET last_called_at = ? WHERE id = ?').run(e.at, e.contactId);
        break;
      case 'suggestion.shown':
        // the same id re-emitted replaces the card in place, so only a first showing counts
        if (!this.seen(e.callId, 'suggestion.shown', '$.suggestion.id', e.suggestion.id, e.seq)) db.prepare('UPDATE calls SET cues_shown = cues_shown + 1 WHERE id = ?').run(e.callId);
        break;
      case 'suggestion.action':
        if ((e.action === 'used' || e.action === 'edited') && !this.usedBefore(e.callId, e.suggestionId, e.seq)) db.prepare('UPDATE calls SET cues_used = cues_used + 1 WHERE id = ?').run(e.callId);
        break;
      case 'call.ended':
        db.prepare("UPDATE calls SET status = CASE WHEN status = 'live' THEN 'ended' ELSE status END, ended_at = ? WHERE id = ?").run(e.at, e.callId);
        break;
      case 'outcome.recorded':
        db.prepare('UPDATE calls SET outcome = ? WHERE id = ?').run(e.outcome.outcome, e.callId);
        break;
      case 'feedback.submitted':
        db.prepare("UPDATE calls SET has_feedback = 1, status = 'reviewing', rating = COALESCE(?, rating), attitude = COALESCE(?, attitude) WHERE id = ?").run(
          e.feedback.rating ?? null,
          e.feedback.attitude ?? null,
          e.callId,
        );
        break;
      case 'review.completed':
        db.prepare("UPDATE calls SET status = 'reviewed', impact = ?, attitude = COALESCE(attitude, ?) WHERE id = ?").run(e.review.suggestionImpact, e.review.customerAttitude, e.callId);
        break;
      default:
        break;
    }
  }

  private seen(callId: string, type: string, path: string, value: string, beforeSeq: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM events WHERE call_id = ? AND type = ? AND seq < ? AND json_extract(json, ?) = ? LIMIT 1').get(callId, type, beforeSeq, path, value);
  }

  private usedBefore(callId: string, suggestionId: string, beforeSeq: number): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM events WHERE call_id = ? AND type = 'suggestion.action' AND seq < ? AND json_extract(json, '$.suggestionId') = ? AND json_extract(json, '$.action') IN ('used', 'edited') LIMIT 1")
      .get(callId, beforeSeq, suggestionId);
  }

  list(callId: string, afterSeq = 0): CallEvent[] {
    const rows = this.db.prepare('SELECT json FROM events WHERE call_id = ? AND seq > ? ORDER BY seq').all(callId, afterSeq) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as CallEvent);
  }

  has(callId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM calls WHERE id = ?').get(callId);
  }

  /** The reduced view, cached per call and updated incrementally on append. */
  view(callId: string): CallView | null {
    const hit = this.views.get(callId);
    if (hit) {
      this.views.delete(callId);
      this.views.set(callId, hit);
      return hit;
    }
    const events = this.list(callId);
    if (!events.length) return null;
    const v = reduceCall(events);
    this.cacheView(callId, v);
    return v;
  }

  private cacheView(callId: string, v: CallView): void {
    this.views.delete(callId);
    this.views.set(callId, v);
    while (this.views.size > VIEW_CACHE) {
      const oldest = this.views.keys().next().value as string;
      this.views.delete(oldest);
    }
  }

  subscribe(callId: string, fn: Listener): () => void {
    let set = this.listeners.get(callId);
    if (!set) this.listeners.set(callId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(callId);
    };
  }

  call(callId: string): CallRow | null {
    const r = this.db.prepare('SELECT * FROM calls WHERE id = ?').get(callId) as RawCallRow | undefined;
    return r ? toRow(r) : null;
  }

  calls(q: { limit?: number; status?: CallStatus; where?: 'ended_without_outcome' | 'ended_with_outcome_unreviewed' } = {}): CallRow[] {
    const limit = Math.max(1, Math.min(500, q.limit ?? 50));
    let sql = 'SELECT * FROM calls';
    if (q.where === 'ended_without_outcome') sql += " WHERE status = 'ended' AND outcome IS NULL AND source NOT IN ('practice', 'import')";
    else if (q.where === 'ended_with_outcome_unreviewed') sql += " WHERE status = 'ended' AND outcome IS NOT NULL";
    else if (q.status) sql += ' WHERE status = ?';
    sql += ' ORDER BY started_at DESC LIMIT ?';
    const rows = (q.status && !q.where ? this.db.prepare(sql).all(q.status, limit) : this.db.prepare(sql).all(limit)) as unknown as RawCallRow[];
    return rows.map(toRow);
  }

  /** History rows, newest first, filtered by rep, outcome, status, contact, source, date and text. */
  summaries(q: CallListQuery | number = {}): CallSummary[] {
    const query = typeof q === 'number' ? { limit: q } : q;
    const { sql, args } = filterSql(query);
    const limit = Math.max(1, Math.min(500, query.limit ?? 50));
    const offset = Math.max(0, query.offset ?? 0);
    const rows = this.db.prepare(`SELECT * FROM calls${sql} ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as unknown as RawCallRow[];
    return rows.map((r) => this.summary(toRow(r)));
  }

  /** How many calls match the same filters (for paging). */
  countSummaries(q: CallListQuery = {}): number {
    const { sql, args } = filterSql(q);
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM calls${sql}`).get(...args) as { n: number }).n;
  }

  private summary(c: CallRow): CallSummary {
    const v = this.view(c.id) ?? emptyView(c.id);
    const fb = v.feedback;
    const wentWell = distinct([...(v.review?.whatWorked ?? []), ...(fb?.whatWorked ? [fb.whatWorked] : [])]);
    const wentBadly = distinct([...(v.review?.whatDidnt ?? []), ...(fb?.whatDidnt ? [fb.whatDidnt] : [])]);
    return {
      id: c.id,
      status: v.status,
      source: v.source,
      startedAt: v.startedAt,
      durationMs: v.endedAt !== null ? Math.max(0, v.endedAt - v.startedAt) : null,
      prospect: { name: v.prospect.name, title: v.prospect.title, company: v.prospect.company },
      outcome: v.outcome?.outcome ?? null,
      suggestions: v.history.length,
      used: v.history.filter((h) => h.action === 'used').length,
      rep: { id: v.rep.id, name: v.rep.name },
      contactId: c.contactId,
      rating: fb?.rating ?? null,
      attitude: fb?.attitude ?? v.review?.customerAttitude ?? null,
      wentWell,
      wentBadly,
      reviewSummary: v.review?.summary ?? null,
    };
  }

  /**
   * Each rep's numbers over a window, plus their weekly trend: the team board and "how am I doing".
   * Practice and imported calls are left out; they aren't real dials.
   */
  team(q: { from?: number; to?: number; weeks?: number } = {}): TeamResponse {
    const to = q.to ?? this.now();
    const from = q.from ?? 0;
    const args = [from, to];
    const where = "WHERE started_at >= ? AND started_at <= ? AND rep_id IS NOT NULL AND source NOT IN ('practice', 'import')";
    const rows = this.db
      .prepare(
        `SELECT rep_id, MAX(rep_name) AS rep_name, COUNT(*) AS calls,
                SUM(outcome IS NOT NULL AND outcome NOT IN ('no_answer', 'voicemail')) AS connected,
                SUM(outcome = 'meeting_booked') AS booked,
                SUM(cues_shown) AS shown, SUM(cues_used) AS used,
                AVG(rating) AS rating, AVG(impact) AS impact, MAX(started_at) AS last_at,
                SUM(has_feedback) AS debriefed
         FROM calls ${where} GROUP BY rep_id ORDER BY booked DESC, calls DESC`,
      )
      .all(...args) as Record<string, number | string | null>[];
    const weeks = Math.max(1, Math.min(26, q.weeks ?? 8));
    const WEEK = 7 * 86_400_000;
    // buckets are (start, to], oldest first, so a call made right now lands in the last week
    const start = to - weeks * WEEK;
    const trend = this.db
      .prepare(`SELECT rep_id, CAST((started_at - ? - 1) / ${WEEK} AS INTEGER) AS w, COUNT(*) AS calls, SUM(outcome = 'meeting_booked') AS booked FROM calls ${where} AND started_at > ? GROUP BY rep_id, w`)
      .all(start, ...args, start) as { rep_id: string; w: number; calls: number; booked: number }[];
    const members: TeamMember[] = rows.map((r) => {
      const calls = Number(r.calls ?? 0);
      const connected = Number(r.connected ?? 0);
      const booked = Number(r.booked ?? 0);
      const weekly = Array.from({ length: weeks }, (_, w) => {
        const t = trend.find((x) => x.rep_id === r.rep_id && x.w === w);
        return { weekStart: start + w * WEEK, calls: t?.calls ?? 0, booked: t?.booked ?? 0 };
      });
      return {
        rep: { id: String(r.rep_id), name: String(r.rep_name ?? r.rep_id) },
        calls,
        connected,
        booked,
        bookingRate: connected ? booked / connected : 0,
        cuesShown: Number(r.shown ?? 0),
        cuesUsed: Number(r.used ?? 0),
        avgRating: r.rating === null ? null : Number(r.rating),
        avgImpact: r.impact === null ? null : Number(r.impact),
        debriefed: Number(r.debriefed ?? 0),
        lastCallAt: r.last_at === null ? null : Number(r.last_at),
        weekly,
      };
    });
    const sum = (k: 'calls' | 'connected' | 'booked' | 'cuesShown' | 'cuesUsed' | 'debriefed') => members.reduce((n, m) => n + (m[k] ?? 0), 0);
    const connected = sum('connected');
    const rated = members.filter((m) => m.avgRating !== null);
    return {
      members,
      totals: {
        reps: members.length,
        calls: sum('calls'),
        connected,
        booked: sum('booked'),
        bookingRate: connected ? sum('booked') / connected : 0,
        cuesShown: sum('cuesShown'),
        cuesUsed: sum('cuesUsed'),
        debriefed: sum('debriefed'),
        avgRating: rated.length ? rated.reduce((n, m) => n + m.avgRating! * m.calls, 0) / rated.reduce((n, m) => n + m.calls, 0) : null,
      },
      from,
      to,
    };
  }

  setPractice(callId: string, p: PracticeState): void {
    this.db.prepare('UPDATE calls SET practice_json = ? WHERE id = ?').run(JSON.stringify(p), callId);
  }

  countCalls(): { total: number; booked: number; reviewed: number; withFeedback: number } {
    const r = this.db
      .prepare(
        "SELECT COUNT(*) AS total, SUM(outcome = 'meeting_booked') AS booked, SUM(status = 'reviewed') AS reviewed, SUM(has_feedback) AS withFeedback FROM calls",
      )
      .get() as Record<string, number | null>;
    return { total: r.total ?? 0, booked: r.booked ?? 0, reviewed: r.reviewed ?? 0, withFeedback: r.withFeedback ?? 0 };
  }

  findByTrellusSession(sessionId: string): string | null {
    const r = this.db.prepare('SELECT id FROM calls WHERE trellus_session_id = ?').get(sessionId) as { id: string } | undefined;
    return r?.id ?? null;
  }
}

interface RawCallRow {
  id: string;
  status: string;
  source: string;
  started_at: number;
  ended_at: number | null;
  prospect_json: string;
  trellus_session_id: string | null;
  outcome: string | null;
  practice_json: string | null;
  has_feedback: number;
  rep_id: string | null;
  contact_id: string | null;
}

function toRow(r: RawCallRow): CallRow {
  return {
    id: r.id,
    status: r.status as CallStatus,
    source: r.source,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    prospect: JSON.parse(r.prospect_json) as Prospect,
    trellusSessionId: r.trellus_session_id,
    outcome: r.outcome,
    practice: r.practice_json ? (JSON.parse(r.practice_json) as PracticeState) : null,
    hasFeedback: !!r.has_feedback,
    repId: r.rep_id,
    contactId: r.contact_id,
  };
}

/** Drops repeats (the review often restates the rep's own words), ignoring case, spacing and end punctuation. */
function distinct(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((l) => {
    const k = l.toLowerCase().replace(/[\s.!]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function filterSql(q: CallListQuery): { sql: string; args: (string | number)[] } {
  const w: string[] = [];
  const args: (string | number)[] = [];
  if (q.repId) w.push('rep_id = ?') && args.push(q.repId);
  if (q.outcome === 'none') w.push('outcome IS NULL');
  else if (q.outcome) w.push('outcome = ?') && args.push(q.outcome);
  if (q.status) w.push('status = ?') && args.push(q.status);
  if (q.contactId) w.push('contact_id = ?') && args.push(q.contactId);
  if (q.source) w.push('source = ?') && args.push(q.source);
  if (q.debriefed === '1') w.push("(has_feedback = 1 OR status IN ('reviewing', 'reviewed'))");
  else if (q.debriefed === '0') w.push("(has_feedback = 0 AND status NOT IN ('reviewing', 'reviewed'))");
  if (q.from !== undefined) w.push('started_at >= ?') && args.push(q.from);
  if (q.to !== undefined) w.push('started_at <= ?') && args.push(q.to);
  const text = q.q?.trim().toLowerCase();
  if (text) {
    const like = `%${text.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    w.push("(lower(json_extract(prospect_json, '$.name')) LIKE ? ESCAPE '\\' OR lower(json_extract(prospect_json, '$.company')) LIKE ? ESCAPE '\\' OR lower(json_extract(prospect_json, '$.title')) LIKE ? ESCAPE '\\' OR lower(rep_name) LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like);
  }
  return { sql: w.length ? ` WHERE ${w.join(' AND ')}` : '', args };
}

export class StoreError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}
