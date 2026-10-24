import { CallEvent, type CallEventInput, type CallSummary, type CallView, type CallStatus, type Prospect } from '@cue/core';
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
        db.prepare('INSERT INTO calls (id, status, source, started_at, prospect_json, rep_json, trellus_session_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          e.callId,
          'live',
          e.source,
          e.at,
          JSON.stringify(e.prospect),
          JSON.stringify(e.rep),
          e.trellusSessionId ?? null,
        );
        break;
      case 'call.ended':
        db.prepare("UPDATE calls SET status = CASE WHEN status = 'live' THEN 'ended' ELSE status END, ended_at = ? WHERE id = ?").run(e.at, e.callId);
        break;
      case 'outcome.recorded':
        db.prepare('UPDATE calls SET outcome = ? WHERE id = ?').run(e.outcome.outcome, e.callId);
        break;
      case 'feedback.submitted':
        db.prepare("UPDATE calls SET has_feedback = 1, status = 'reviewing' WHERE id = ?").run(e.callId);
        break;
      case 'review.completed':
        db.prepare("UPDATE calls SET status = 'reviewed' WHERE id = ?").run(e.callId);
        break;
      default:
        break;
    }
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

  summaries(limit = 50): CallSummary[] {
    return this.calls({ limit }).map((c) => {
      const v = this.view(c.id) ?? emptyView(c.id);
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
      };
    });
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
  };
}

export class StoreError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}
