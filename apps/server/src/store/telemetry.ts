import { TASK_IDS, type TaskId, type TaskStats } from '@cue/core';
import type { Db } from './db';

export interface MubitCallRow {
  requestId: string | null;
  task: TaskId;
  model: string;
  sessionId: string;
  ok: boolean;
  latencyMs: number;
  inTok: number;
  outTok: number;
  costUsd: number;
  at: number;
  errorCode: string | null;
}

/** Durable per-task Mubit telemetry (survives restarts, unlike the client's in-memory counters). */
export class TelemetryStore {
  constructor(private db: Db) {}

  record(r: MubitCallRow): void {
    this.db
      .prepare('INSERT INTO mubit_calls (request_id, task, model, session_id, ok, latency_ms, in_tok, out_tok, cost_usd, at, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.requestId, r.task, r.model, r.sessionId, r.ok ? 1 : 0, Math.round(r.latencyMs), r.inTok, r.outTok, r.costUsd, r.at, r.errorCode);
  }

  /** `(mubitRequestId → call, suggestion)`: the join an outcome-weighted training hook would need. */
  link(requestId: string | null | undefined, callId: string, task: TaskId, suggestionId?: string): void {
    if (!requestId) return;
    this.db.prepare('INSERT INTO mubit_links (request_id, call_id, suggestion_id, task) VALUES (?, ?, ?, ?)').run(requestId, callId, suggestionId ?? null, task);
  }

  links(callId: string): { requestId: string; suggestionId: string | null; task: string }[] {
    return (this.db.prepare('SELECT request_id AS requestId, suggestion_id AS suggestionId, task FROM mubit_links WHERE call_id = ?').all(callId) as unknown) as {
      requestId: string;
      suggestionId: string | null;
      task: string;
    }[];
  }

  /** The most recent call of any task, for /health's `reachable`. */
  last(): { ok: boolean; errorCode: string | null; at: number } | null {
    const r = this.db.prepare("SELECT ok, error_code AS errorCode, at FROM mubit_calls WHERE COALESCE(error_code, '') NOT IN ('aborted', 'not_configured') ORDER BY id DESC LIMIT 1").get() as
      | { ok: number; errorCode: string | null; at: number }
      | undefined;
    return r ? { ok: !!r.ok, errorCode: r.errorCode, at: r.at } : null;
  }

  stats(models: Record<TaskId, string>): TaskStats[] {
    return TASK_IDS.map((task) => {
      const agg = this.db
        .prepare(
          "SELECT COUNT(*) AS calls, COALESCE(SUM(ok), 0) AS ok, COALESCE(SUM(error_code = 'aborted'), 0) AS aborted, COUNT(DISTINCT session_id) AS sessions, COALESCE(SUM(in_tok), 0) AS inTok, COALESCE(SUM(out_tok), 0) AS outTok, COALESCE(SUM(cost_usd), 0) AS cost FROM mubit_calls WHERE task = ?",
        )
        .get(task) as { calls: number; ok: number; aborted: number; sessions: number; inTok: number; outTok: number; cost: number };
      const lat = (this.db.prepare('SELECT latency_ms AS l FROM mubit_calls WHERE task = ? AND ok = 1 ORDER BY id DESC LIMIT 1000').all(task) as { l: number }[]).map((r) => r.l).sort((a, b) => a - b);
      const last = this.db.prepare('SELECT request_id AS id, model FROM mubit_calls WHERE task = ? ORDER BY id DESC LIMIT 1').get(task) as { id: string | null; model: string } | undefined;
      const lastId = this.db.prepare('SELECT request_id AS id FROM mubit_calls WHERE task = ? AND request_id IS NOT NULL ORDER BY id DESC LIMIT 1').get(task) as { id: string } | undefined;
      return {
        task,
        model: last?.model ?? models[task],
        calls: agg.calls,
        ok: agg.ok,
        // Cancelled-but-sent runs count as calls (Mubit saw them) but not as failures.
        failed: agg.calls - agg.ok - agg.aborted,
        sessions: agg.sessions,
        p50Ms: percentile(lat, 0.5),
        p95Ms: percentile(lat, 0.95),
        inputTokens: agg.inTok,
        outputTokens: agg.outTok,
        costUsd: Math.round(agg.cost * 1e6) / 1e6,
        adapterThreshold: 25,
        lastRequestId: lastId?.id ?? null,
      };
    });
  }
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}
