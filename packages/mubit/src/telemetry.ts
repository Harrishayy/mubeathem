import { TASK_IDS, type TaskId, type TaskStats } from '@cue/core';

/** List prices per 1M tokens (input, output), USD. Dated ids match by prefix. */
export const PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
};

export function costUsd(model: string, usage: { input: number; output: number }): number {
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  if (!key) return 0;
  const p = PRICES[key]!;
  return (usage.input * p.input + usage.output * p.output) / 1_000_000;
}

/** Mubit trains a task's first adapter at 25 kept examples by default. */
export const ADAPTER_THRESHOLD = 25;

/** One finished `run`, success or failure. The server persists these via `client.onCall`. */
export interface CallRecordEvent {
  task: TaskId;
  model: string;
  sessionId: string;
  ok: boolean;
  requestId: string | null;
  latencyMs: number;
  attempts: number;
  usage: { input: number; output: number };
  costUsd: number;
  /** Mubit or local error code on failure. */
  error: { code: string; status: number | null; message: string } | null;
  at: number;
}

const MAX_SAMPLES = 2000;

interface Counter {
  model: string;
  calls: number;
  ok: number;
  failed: number;
  sessions: Set<string>;
  latencies: number[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  lastRequestId: string | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i]!;
}

/** In-memory per-task counters. Process-lifetime only; the server keeps the durable copy. */
export class Telemetry {
  private readonly counters = new Map<TaskId, Counter>();

  constructor(private readonly modelFor: (task: TaskId) => string) {}

  record(e: CallRecordEvent): void {
    let c = this.counters.get(e.task);
    if (!c) {
      c = { model: e.model, calls: 0, ok: 0, failed: 0, sessions: new Set(), latencies: [], inputTokens: 0, outputTokens: 0, costUsd: 0, lastRequestId: null };
      this.counters.set(e.task, c);
    }
    c.model = e.model;
    c.calls += 1;
    if (e.ok) c.ok += 1;
    else c.failed += 1;
    c.sessions.add(e.sessionId);
    if (e.ok) {
      c.latencies.push(e.latencyMs);
      if (c.latencies.length > MAX_SAMPLES) c.latencies.shift();
    }
    c.inputTokens += e.usage.input;
    c.outputTokens += e.usage.output;
    c.costUsd += e.costUsd;
    if (e.requestId) c.lastRequestId = e.requestId;
  }

  stats(): TaskStats[] {
    return TASK_IDS.map((task) => {
      const c = this.counters.get(task);
      const sorted = c ? [...c.latencies].sort((a, b) => a - b) : [];
      return {
        task,
        model: c?.model ?? this.modelFor(task),
        calls: c?.calls ?? 0,
        ok: c?.ok ?? 0,
        failed: c?.failed ?? 0,
        sessions: c?.sessions.size ?? 0,
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        inputTokens: c?.inputTokens ?? 0,
        outputTokens: c?.outputTokens ?? 0,
        costUsd: c?.costUsd ?? 0,
        adapterThreshold: ADAPTER_THRESHOLD,
        lastRequestId: c?.lastRequestId ?? null,
      };
    });
  }
}
