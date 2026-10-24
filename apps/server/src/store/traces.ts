import { newId, type MubitTrace, type MubitTraceSummary, type TaskId, type TraceListQuery, type TraceListResponse, type TraceRange } from '@cue/core';
import { tx, type Db } from './db';

/** What ModelRunner hands over per Mubit call. Bodies stay objects until the flush serialises them. */
export interface TraceInput {
  requestId: string | null;
  task: TaskId;
  model: string;
  sessionId: string;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  at: number;
  instructionsVersion: number;
  input: unknown;
  output: unknown;
  aborted: boolean;
}

export interface TraceStoreOptions {
  /** `metadata` (CUE_MUBIT_RECORD=metadata): keep no request or answer bodies locally either. */
  record: 'full' | 'metadata';
  /** Per-body cap in bytes of JSON; longer bodies are kept as a string prefix with `truncated`. */
  maxBodyBytes: number;
  flushMs?: number;
  flushRows?: number;
  onError?: (message: string) => void;
}

interface Pending extends TraceInput {
  id: string;
  callId: string | null;
  suggestionId: string | null;
}

interface Row {
  seq: number;
  id: string;
  request_id: string | null;
  task: TaskId;
  model: string;
  session_id: string;
  call_id: string | null;
  suggestion_id: string | null;
  ok: number;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number;
  attempts: number;
  in_tok: number;
  out_tok: number;
  cost_usd: number;
  at: number;
  instructions_version: number;
  input_json?: string | null;
  output_json?: string | null;
  aborted: number;
  truncated: number;
}

const SUMMARY_COLS =
  'seq, id, request_id, task, model, session_id, call_id, suggestion_id, ok, error_code, error_message, latency_ms, attempts, in_tok, out_tok, cost_usd, at, instructions_version, aborted, truncated';

const DAY = 86_400_000;

/** Window start for a range (0 for `all`). */
export function rangeSince(range: TraceRange, now: number): number {
  return range === '24h' ? now - DAY : range === '7d' ? now - 7 * DAY : range === '30d' ? now - 30 * DAY : 0;
}

/** Sessions that are phone calls (`call_…`); seed and script sessions have no call. */
function callIdOf(sessionId: string): string | null {
  return sessionId.startsWith('call_') ? sessionId : null;
}

/**
 * The trace of every Mubit call, owned by us because Mubit has no trace export. `record` and `link`
 * only push to memory, so the live pipeline never waits on SQLite; a flush writes everything queued
 * in one transaction every `flushMs` (or as soon as `flushRows` are waiting), and on close.
 */
export class TraceStore {
  private buf: Pending[] = [];
  private links: { requestId: string; callId: string; suggestionId: string | null }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private immediate: ReturnType<typeof setImmediate> | null = null;
  private closed = false;
  private readonly flushMs: number;
  private readonly flushRows: number;

  constructor(
    private db: Db,
    private opts: TraceStoreOptions,
  ) {
    this.flushMs = opts.flushMs ?? 250;
    this.flushRows = opts.flushRows ?? 50;
  }

  get pending(): number {
    return this.buf.length + this.links.length;
  }

  /** Queues one trace and returns its id. Never throws. */
  record(t: TraceInput): string | null {
    if (this.closed) return null;
    const id = newId('trc', { now: t.at });
    const metadataOnly = this.opts.record === 'metadata';
    this.buf.push({ ...t, id, callId: callIdOf(t.sessionId), suggestionId: null, input: metadataOnly ? null : t.input, output: metadataOnly ? null : t.output });
    this.schedule();
    return id;
  }

  /** Ties the trace(s) of a Mubit request to a phone call and, when known, the card it fed. */
  link(requestId: string | null | undefined, callId: string, suggestionId?: string | null): void {
    if (!requestId || this.closed) return;
    this.links.push({ requestId, callId, suggestionId: suggestionId ?? null });
    this.schedule();
  }

  private schedule(): void {
    if (this.buf.length + this.links.length >= this.flushRows) {
      if (!this.immediate) {
        this.immediate = setImmediate(() => {
          this.immediate = null;
          this.flush();
        });
        this.immediate.unref?.();
      }
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.flushMs);
      this.timer.unref?.();
    }
  }

  /** Writes everything queued in one transaction. Returns the number of traces written. Never throws. */
  flush(): number {
    if (this.timer) clearTimeout(this.timer), (this.timer = null);
    if (this.immediate) clearImmediate(this.immediate), (this.immediate = null);
    if (!this.buf.length && !this.links.length) return 0;
    const rows = this.buf;
    const links = this.links;
    this.buf = [];
    this.links = [];
    try {
      tx(this.db, () => {
        const ins = this.db.prepare(
          `INSERT INTO mubit_traces (id, request_id, task, model, session_id, call_id, suggestion_id, ok, error_code, error_message, latency_ms, attempts, in_tok, out_tok, cost_usd, at, instructions_version, input_json, output_json, aborted, truncated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of rows) {
          const input = this.body(r.input);
          const output = this.body(r.output);
          ins.run(
            r.id,
            r.requestId,
            r.task,
            r.model,
            r.sessionId,
            r.callId,
            r.suggestionId,
            r.ok ? 1 : 0,
            r.errorCode,
            r.errorMessage ? r.errorMessage.slice(0, 2000) : null,
            Math.max(0, Math.round(r.latencyMs)),
            r.attempts,
            r.inputTokens,
            r.outputTokens,
            r.costUsd,
            r.at,
            r.instructionsVersion,
            input.json,
            output.json,
            r.aborted ? 1 : 0,
            input.truncated || output.truncated ? 1 : 0,
          );
        }
        const upd = this.db.prepare('UPDATE mubit_traces SET call_id = ?, suggestion_id = COALESCE(?, suggestion_id) WHERE request_id = ?');
        for (const l of links) upd.run(l.callId, l.suggestionId, l.requestId);
      });
      return rows.length;
    } catch (e) {
      this.opts.onError?.(`trace flush failed (${rows.length} traces dropped): ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  }

  /** JSON text for a body, capped at `maxBodyBytes` (kept as a JSON string of the prefix). */
  private body(v: unknown): { json: string | null; truncated: boolean } {
    if (v === null || v === undefined) return { json: null, truncated: false };
    let text: string;
    try {
      text = JSON.stringify(v);
    } catch {
      return { json: JSON.stringify('[unserialisable]'), truncated: true };
    }
    const cap = this.opts.maxBodyBytes;
    if (Buffer.byteLength(text) <= cap) return { json: text, truncated: false };
    return { json: JSON.stringify(Buffer.from(text).subarray(0, cap).toString('utf8')), truncated: true };
  }

  /** Flushes and stops accepting traces. Call before closing the database. */
  close(): void {
    this.flush();
    this.closed = true;
  }

  /** Deletes traces older than `days` (0 keeps everything). Returns rows removed. */
  prune(days: number, now: number): number {
    if (!(days > 0)) return 0;
    return Number(this.db.prepare('DELETE FROM mubit_traces WHERE at < ?').run(now - days * DAY).changes);
  }

  list(q: TraceListQuery): TraceListResponse {
    this.flush();
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.task) where.push('task = ?'), args.push(q.task);
    if (q.callId) where.push('(call_id = ? OR session_id = ?)'), args.push(q.callId, q.callId);
    if (q.ok !== undefined) where.push('ok = ?'), args.push(q.ok ? 1 : 0);
    if (q.before) where.push('seq < ?'), args.push(Number(q.before));
    const rows = this.db
      .prepare(`SELECT ${SUMMARY_COLS} FROM mubit_traces ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY seq DESC LIMIT ?`)
      .all(...args, q.limit + 1) as unknown as Row[];
    const more = rows.length > q.limit;
    const page = more ? rows.slice(0, q.limit) : rows;
    return { items: page.map(toSummary), nextCursor: more ? String(page[page.length - 1]!.seq) : null };
  }

  get(id: string): MubitTrace | null {
    this.flush();
    const row = this.db.prepare(`SELECT ${SUMMARY_COLS}, input_json, output_json FROM mubit_traces WHERE id = ?`).get(id) as unknown as Row | undefined;
    return row ? toTrace(row) : null;
  }

  /** Every trace in a window, oldest first, read in pages so a big export never holds the table. */
  *iterate(f: { since: number; task?: TaskId | undefined; okOnly?: boolean }, pageSize = 500): Generator<MubitTrace> {
    this.flush();
    let after = 0;
    for (;;) {
      const where = ['seq > ?', 'at >= ?'];
      const args: (string | number)[] = [after, f.since];
      if (f.task) where.push('task = ?'), args.push(f.task);
      if (f.okOnly) where.push('ok = 1');
      const rows = this.db.prepare(`SELECT ${SUMMARY_COLS}, input_json, output_json FROM mubit_traces WHERE ${where.join(' AND ')} ORDER BY seq ASC LIMIT ?`).all(...args, pageSize) as unknown as Row[];
      for (const r of rows) yield toTrace(r);
      if (rows.length < pageSize) return;
      after = rows[rows.length - 1]!.seq;
    }
  }

  /** Metadata of every trace in a window (no bodies), for insights. */
  metadata(since: number): MubitTraceSummary[] {
    this.flush();
    return (this.db.prepare(`SELECT ${SUMMARY_COLS} FROM mubit_traces WHERE at >= ? ORDER BY at ASC`).all(since) as unknown as Row[]).map(toSummary);
  }
}

function toSummary(r: Row): MubitTraceSummary {
  return {
    id: r.id,
    requestId: r.request_id,
    task: r.task,
    model: r.model,
    sessionId: r.session_id,
    callId: r.call_id,
    suggestionId: r.suggestion_id,
    ok: !!r.ok,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    latencyMs: r.latency_ms,
    attempts: r.attempts,
    inputTokens: r.in_tok,
    outputTokens: r.out_tok,
    costUsd: r.cost_usd,
    at: r.at,
    instructionsVersion: r.instructions_version,
    aborted: !!r.aborted,
    truncated: !!r.truncated,
  };
}

function parse(text: string | null | undefined): unknown {
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toTrace(r: Row): MubitTrace {
  return { ...toSummary(r), input: parse(r.input_json), output: parse(r.output_json) };
}
