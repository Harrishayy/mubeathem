import type { TaskId, TaskInput, TaskOutput } from '@cue/core';
import { asMubitError, type MubitClient } from '../adapters/mubit';
import type { TelemetryStore } from '../store/telemetry';
import type { SentCounter } from './sent';

export type ModelResult<K extends TaskId> =
  | { ok: true; output: TaskOutput<K>; requestId: string | null; latencyMs: number; model: string }
  | { ok: false; code: string; message: string; retryable: boolean; requestId: string | null; latencyMs: number; /** The caller cancelled (superseded turn, call ended). */ aborted: boolean };

export const TASK_TIER: Record<TaskId, 'fast' | 'write'> = {
  read_moment: 'fast',
  check_claim: 'fast',
  simulate_prospect: 'fast',
  write_line: 'write',
  research_brief: 'write',
  review_call: 'write',
};

/**
 * Every model call goes through here: a budget per call, cancellation, durable telemetry, and a
 * result instead of an exception, so the pipeline can always fall back to rules.
 */
export class ModelRunner {
  constructor(
    private mubit: MubitClient | null,
    private telemetry: TelemetryStore,
    readonly models: { fast: string; write: string },
    private now: () => number = Date.now,
    private sent: SentCounter | null = null,
  ) {}

  /** Result of the last `ping()`, or null if never pinged. */
  lastPing: { ok: boolean; at: number } | null = null;

  async ping(): Promise<boolean | null> {
    if (!this.mubit?.ping) return null;
    const ok = await this.mubit.ping(AbortSignal.timeout(5000)).catch(() => false);
    this.lastPing = { ok, at: this.now() };
    return ok;
  }

  get configured(): boolean {
    return this.mubit !== null;
  }

  modelFor(task: TaskId): string {
    return this.models[TASK_TIER[task]];
  }

  async run<K extends TaskId>(task: K, input: TaskInput<K>, opts: { callId: string; signal?: AbortSignal; budgetMs: number }): Promise<ModelResult<K>> {
    const started = this.now();
    if (!this.mubit) return { ok: false, code: 'not_configured', message: 'MUBIT_API_KEY is not set', retryable: false, requestId: null, latencyMs: 0, aborted: false };
    if (opts.signal?.aborted) return { ok: false, code: 'aborted', message: 'cancelled', retryable: false, requestId: null, latencyMs: 0, aborted: true };

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
      const call = this.mubit.run(task, input, { sessionId: opts.callId, signal, timeoutMs: opts.budgetMs });
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
      return { ok: true, output: res.output, requestId: res.requestId, latencyMs, model: res.model || this.modelFor(task) };
    } catch (e) {
      const err = asMubitError(e);
      const aborted = !!opts.signal?.aborted;
      const code = aborted ? 'aborted' : budget.signal.aborted ? 'timeout' : err.code;
      const latencyMs = this.now() - started;
      // A cancelled run (superseded turn, speculative draft dropped) is recorded only if it really went out.
      const sentAndAborted = aborted && !!this.sent && this.sent.count(opts.callId, task) > sentBefore;
      if (sentAndAborted)
        this.telemetry.record({ requestId: err.requestId, task, model: this.modelFor(task), sessionId: opts.callId, ok: false, latencyMs, inTok: 0, outTok: 0, costUsd: 0, at: this.now(), errorCode: 'aborted' });
      else if (!aborted && code !== 'not_configured')
        this.telemetry.record({ requestId: err.requestId, task, model: this.modelFor(task), sessionId: opts.callId, ok: false, latencyMs, inTok: 0, outTok: 0, costUsd: 0, at: this.now(), errorCode: code });
      return { ok: false, code, message: err.message, retryable: err.retryable || code === 'timeout', requestId: err.requestId, latencyMs, aborted };
    } finally {
      clearTimeout(timer);
      if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
    }
  }
}
