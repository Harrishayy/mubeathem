import type { TaskId, TaskInput, TaskOutput } from '@cue/core';
import { asMubitError, TASKS, type MubitClient } from '../adapters/mubit';
import type { TelemetryStore } from '../store/telemetry';
import type { TraceInput, TraceStore } from '../store/traces';
import type { SentCounter } from './sent';

export type ModelResult<K extends TaskId> =
  | { ok: true; output: TaskOutput<K>; requestId: string | null; latencyMs: number; model: string }
  | { ok: false; code: string; message: string; retryable: boolean; requestId: string | null; latencyMs: number; /** The caller cancelled (superseded turn, call ended). */ aborted: boolean };

export const TASK_TIER: Record<TaskId, 'fast' | 'write' | 'live'> = {
  read_moment: 'fast',
  check_claim: 'fast',
  simulate_prospect: 'fast',
  write_line: 'write',
  research_brief: 'write',
  review_call: 'write',
  live_cue: 'live',
  synth_brief: 'write',
};

/**
 * Every model call goes through here: a budget per call, cancellation, durable telemetry, and a
 * result instead of an exception, so the pipeline can always fall back to rules.
 */
export class ModelRunner {
  constructor(
    private mubit: MubitClient | null,
    private telemetry: TelemetryStore,
    readonly models: { fast: string; write: string; live?: string },
    private now: () => number = Date.now,
    private sent: SentCounter | null = null,
    /** Full trace per call (buffered in memory, flushed off the request path). */
    private traces: TraceStore | null = null,
  ) {}

  /** Queues a trace. A trace failure must never fail the call it describes. */
  private trace(t: Omit<TraceInput, 'instructionsVersion'>): void {
    if (!this.traces) return;
    try {
      this.traces.record({ ...t, instructionsVersion: TASKS[t.task]?.version ?? 0 });
    } catch {
      /* never let tracing break the pipeline */
    }
  }

  /** Result of the last `ping()`, or null if never pinged. */
  lastPing: { ok: boolean; at: number } | null = null;

  async ping(): Promise<boolean | null> {
    if (!this.mubit?.ping) return null;
    const ok = await this.mubit.ping(AbortSignal.timeout(5000)).catch(() => false);
    this.lastPing = { ok, at: this.now() };
    return ok;
  }

  private lastWarmAt = 0;

  /**
   * Opens (or keeps open) `n` connections to Mubit before a live turn needs them: parallel
   * `GET /models`, no model call, no cost, no trace. Throttled; any real request counts as warm.
   */
  warm(n = 2, minGapMs = 3000): void {
    if (!this.mubit?.ping) return;
    const t = this.now();
    if (t - this.lastWarmAt < minGapMs) return;
    this.lastWarmAt = t;
    for (let i = 0; i < n; i++) void this.mubit.ping(AbortSignal.timeout(3000)).catch(() => false);
  }

  /** Embeds texts through Mubit, or null on any failure or timeout (a slow embedding is worth nothing live). */
  async embed(texts: string[], opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<number[][] | null> {
    if (!this.mubit?.embed || texts.length === 0) return null;
    try {
      return await this.mubit.embed(texts, opts);
    } catch {
      return null;
    }
  }

  get configured(): boolean {
    return this.mubit !== null;
  }

  modelFor(task: TaskId): string {
    const tier = TASK_TIER[task];
    return (tier === 'live' ? this.models.live : this.models[tier]) ?? this.models.write;
  }

  /**
   * With `onFields` the call is streamed (one attempt, no queue) and `onFields` sees each top-level
   * string field of the answer as soon as it is complete.
   */
  async run<K extends TaskId>(task: K, input: TaskInput<K>, opts: { callId: string; signal?: AbortSignal; budgetMs: number; onFields?: (fields: Record<string, string>) => void }): Promise<ModelResult<K>> {
    const started = this.now();
    if (!this.mubit) return { ok: false, code: 'not_configured', message: 'MUBIT_API_KEY is not set', retryable: false, requestId: null, latencyMs: 0, aborted: false };
    if (opts.signal?.aborted) return { ok: false, code: 'aborted', message: 'cancelled', retryable: false, requestId: null, latencyMs: 0, aborted: true };

    this.lastWarmAt = started;
    const sentBefore = this.sent?.count(opts.callId, task) ?? 0;
    const budget = new AbortController();
    const signal = opts.signal ? AbortSignal.any([opts.signal, budget.signal]) : budget.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        budget.abort();
        reject(Object.assign(new Error(`${task} exceeded its ${opts.budgetMs} ms budget`), { code: 'timeout' }));
      }, opts.budgetMs);
      onAbort = () => reject(Object.assign(new Error('cancelled'), { code: 'aborted' }));
      opts.signal?.addEventListener('abort', onAbort, { once: true });
    });
    guard.catch(() => {});
    try {
      const call = opts.onFields && this.mubit.stream
        ? this.mubit.stream(task, input, { sessionId: opts.callId, signal, timeoutMs: opts.budgetMs, onFields: opts.onFields })
        : this.mubit.run(task, input, { sessionId: opts.callId, signal, timeoutMs: opts.budgetMs });
      call.catch(() => {}); // it may settle after the guard has already won
      const res = await Promise.race([call, guard]);
      const latencyMs = res.latencyMs || this.now() - started;
      this.telemetry.record({
        requestId: res.requestId,
        task,
        model: res.model || this.modelFor(task),
        sessionId: opts.callId,
        ok: true,
        latencyMs,
        inTok: res.usage?.input ?? 0,
        outTok: res.usage?.output ?? 0,
        costUsd: res.costUsd ?? 0,
        at: this.now(),
        errorCode: null,
      });
      this.trace({
        requestId: res.requestId,
        task,
        model: res.model || this.modelFor(task),
        sessionId: opts.callId,
        ok: true,
        errorCode: null,
        errorMessage: null,
        latencyMs,
        attempts: res.attempts ?? 1,
        inputTokens: res.usage?.input ?? 0,
        outputTokens: res.usage?.output ?? 0,
        costUsd: res.costUsd ?? 0,
        at: this.now(),
        input,
        output: res.output,
        aborted: false,
      });
      return { ok: true, output: res.output, requestId: res.requestId, latencyMs, model: res.model || this.modelFor(task) };
    } catch (e) {
      const err = asMubitError(e);
      const aborted = !!opts.signal?.aborted;
      const code = aborted ? 'aborted' : budget.signal.aborted ? 'timeout' : err.code;
      const latencyMs = this.now() - started;
      // A cancelled run (superseded turn, speculative draft dropped) is recorded only if it really went out.
      const sentAndAborted = aborted && !!this.sent && this.sent.count(opts.callId, task) > sentBefore;
      const recorded = sentAndAborted ? 'aborted' : !aborted && code !== 'not_configured' ? code : null;
      if (recorded) {
        const at = this.now();
        this.telemetry.record({ requestId: err.requestId, task, model: this.modelFor(task), sessionId: opts.callId, ok: false, latencyMs, inTok: 0, outTok: 0, costUsd: 0, at, errorCode: recorded });
        this.trace({
          requestId: err.requestId,
          task,
          model: this.modelFor(task),
          sessionId: opts.callId,
          ok: false,
          errorCode: recorded,
          errorMessage: err.message,
          latencyMs,
          attempts: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          at,
          input,
          output: null,
          aborted: recorded === 'aborted',
        });
      }
      return { ok: false, code, message: err.message, retryable: err.retryable || code === 'timeout', requestId: err.requestId, latencyMs, aborted };
    } finally {
      clearTimeout(timer);
      if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
    }
  }
}
