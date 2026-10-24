/**
 * The server's view of @cue/mubit (workstream 02). The pipeline depends only on `run`, so a test can
 * inject a fake with just that method and the server can run with no key at all.
 */
import type { TaskId, TaskInput } from '@cue/core';
import type { RunOptions, StreamOptions, TaskResult } from '@cue/mubit';

export { createMubit, loadMubitConfig, MubitError, isMubitError, TASKS, costUsd, ADAPTER_THRESHOLD, SEED_CLAIMS, PRE_QUOTE_EVIDENCE, type MubitConfig, type RunOptions, type StreamOptions, type TaskResult } from '@cue/mubit';

/** Structural subset of @cue/mubit's MubitClient: the real client satisfies it, and so does a test fake. */
export interface MubitClient {
  run<K extends TaskId>(task: K, input: TaskInput<K>, opts: RunOptions): Promise<TaskResult<K>>;
  /** Streamed run (the live path). Optional: without it the runner falls back to `run`. */
  stream?<K extends TaskId>(task: K, input: TaskInput<K>, opts: StreamOptions): Promise<TaskResult<K>>;
  /** Cheap reachability check (no model call). Optional so fakes can skip it. */
  ping?(signal?: AbortSignal): Promise<boolean>;
}

/** The parts of a failure the pipeline reads; @cue/mubit's MubitError has all of them. */
export interface MubitErrorLike {
  code: string;
  message: string;
  status: number | null;
  retryable: boolean;
  requestId: string | null;
}

export function asMubitError(e: unknown): MubitErrorLike {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    const m = e as Partial<MubitErrorLike> & { code: string };
    return { code: m.code, message: String(m.message ?? m.code), status: m.status ?? null, retryable: !!m.retryable, requestId: m.requestId ?? null };
  }
  if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError'))
    return { code: e.name === 'TimeoutError' ? 'timeout' : 'aborted', message: e.message, status: null, retryable: false, requestId: null };
  return { code: 'unknown', message: e instanceof Error ? e.message : String(e), status: null, retryable: false, requestId: null };
}
