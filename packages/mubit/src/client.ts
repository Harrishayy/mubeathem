import { TASK_INPUT, type TaskId, type TaskInput, type TaskOutput, type TaskStats } from '@cue/core';
import type { MubitConfig } from './config';
import { MubitError } from './errors';
import { Semaphore } from './semaphore';
import { toStrictJsonSchema } from './strict-schema';
import { TASKS, type TaskDef } from './tasks';
import { costUsd, Telemetry, type CallRecordEvent } from './telemetry';

export interface RunOptions {
  /** The Mubit session: the phone call's id (sent as `prompt_cache_key`). */
  sessionId: string;
  signal?: AbortSignal;
  /** Overrides config.timeoutMs for this run. The deadline covers queueing, retries and waits. */
  timeoutMs?: number;
}

export interface TaskResult<K extends TaskId> {
  output: TaskOutput<K>;
  /** `x-middleware-request-id` of the answer that produced `output`. */
  requestId: string | null;
  latencyMs: number;
  model: string;
  /** Tokens across every attempt of this run. */
  usage: { input: number; output: number };
  costUsd: number;
  attempts: number;
}

export interface MubitDebugEvent {
  kind: 'request' | 'response';
  task: TaskId;
  attempt: number;
  url: string;
  /** Request headers with `authorization` redacted. */
  headers?: Record<string, string>;
  status?: number;
  requestId?: string | null;
}

export interface MubitDeps {
  fetch?: typeof fetch;
  now?: () => number;
  /** Debug hook. Never receives the key: headers are redacted before it is called. */
  debug?: (e: MubitDebugEvent) => void;
}

export interface MubitClient {
  readonly config: Readonly<MubitConfig>;
  run<K extends TaskId>(task: K, input: TaskInput<K>, opts: RunOptions): Promise<TaskResult<K>>;
  /** Subscribe to every finished run (success or failure). Returns an unsubscribe function. */
  onCall(listener: (e: CallRecordEvent) => void): () => void;
  stats(): TaskStats[];
  modelFor(task: TaskId): string;
  /** Cheap reachability check (`GET /models`, no model call). */
  ping(signal?: AbortSignal): Promise<boolean>;
}

/** Retries per architecture §4.1: at most 2 transport retries, and one retry for an unparseable answer. */
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, k.toLowerCase() === 'authorization' ? 'Bearer [redacted]' : v]));
}

function parseRetryAfter(raw: string | null, now: number): number | null {
  if (!raw) return null;
  const s = Number(raw);
  if (Number.isFinite(s) && s >= 0) return s;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, (at - now) / 1000) : null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface ResponsesBody {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { code?: string; message?: string } | null;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** The structured answer's text, from the first `output_text` part of a `message` item. */
function extractText(body: ResponsesBody, requestId: string | null): string {
  for (const item of body.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'refusal') throw new MubitError({ code: 'refused', message: `model refused: ${part.refusal ?? ''}`.trim(), status: 200, requestId });
      if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  throw new MubitError({ code: 'bad_output', message: 'answer has no output_text', status: 200, requestId });
}

export function createMubit(config: MubitConfig, deps: MubitDeps = {}): MubitClient {
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const now = deps.now ?? Date.now;
  const semaphore = new Semaphore(config.concurrency);
  const modelFor = (task: TaskId) => config.models[TASKS[task].tier];
  const telemetry = new Telemetry(modelFor);
  const listeners = new Set<(e: CallRecordEvent) => void>();
  // Schemas are derived once; they are part of the task's identity and must not vary per call.
  const schemas = new Map<TaskId, Record<string, unknown>>();
  const schemaFor = (def: TaskDef<TaskId>) => {
    let s = schemas.get(def.id);
    if (!s) schemas.set(def.id, (s = toStrictJsonSchema(def.output)));
    return s;
  };

  function headers(): Record<string, string> {
    const h: Record<string, string> = { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' };
    if (config.record === 'metadata') h['x-middleware-record'] = 'metadata';
    return h;
  }

  function emit(e: CallRecordEvent) {
    telemetry.record(e);
    for (const l of listeners) {
      try {
        l(e);
      } catch {
        // A listener's failure must never fail the call it observes.
      }
    }
  }

  async function attempt(task: TaskId, n: number, body: string, signal: AbortSignal) {
    const url = `${config.baseUrl}/responses`;
    const h = headers();
    deps.debug?.({ kind: 'request', task, attempt: n, url, headers: redactHeaders(h) });
    let res: Response;
    try {
      res = await doFetch(url, { method: 'POST', headers: h, body, signal });
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      throw new MubitError({ code: 'network', message: `network error: ${e instanceof Error ? e.message : String(e)}`, retryable: true, cause: e });
    }
    const requestId = res.headers.get('x-middleware-request-id');
    deps.debug?.({ kind: 'response', task, attempt: n, url, status: res.status, requestId });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      const shouldRetry = res.headers.get('x-should-retry');
      const retryable = shouldRetry === 'false' ? false : shouldRetry === 'true' ? true : RETRYABLE_STATUS.has(res.status);
      throw new MubitError({
        code: err?.code || 'http',
        message: err?.message || `HTTP ${res.status}`,
        status: res.status,
        retryable,
        requestId,
        retryAfterS: parseRetryAfter(res.headers.get('retry-after'), now()),
      });
    }
    if (json === null || typeof json !== 'object') {
      throw new MubitError({ code: 'bad_output', message: 'answer body is not JSON', status: res.status, requestId });
    }
    return { requestId, body: json as ResponsesBody, status: res.status };
  }

  async function run<K extends TaskId>(task: K, input: TaskInput<K>, opts: RunOptions): Promise<TaskResult<K>> {
    const start = now();
    const def = TASKS[task] as unknown as TaskDef<K>;
    const model = modelFor(task);
    const usage = { input: 0, output: 0 };
    let attempts = 0;
    let requestId: string | null = null;
    const timeoutMs = opts.timeoutMs ?? config.timeoutMs;

    const finish = (ok: boolean, error: MubitError | null) =>
      emit({
        task,
        model,
        sessionId: opts.sessionId,
        ok,
        requestId,
        latencyMs: now() - start,
        attempts,
        usage: { ...usage },
        costUsd: costUsd(model, usage),
        error: error ? { code: error.code, status: error.status, message: error.message } : null,
        at: start,
      });

    try {
      if (!opts.sessionId) throw new MubitError({ code: 'bad_input', message: 'sessionId is required (the call id)' });
      const parsedInput = TASK_INPUT[task].safeParse(input);
      if (!parsedInput.success) {
        const where = parsedInput.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        throw new MubitError({ code: 'bad_input', message: `invalid ${task} input: ${where}` });
      }
      if (!config.configured) throw new MubitError({ code: 'not_configured', message: 'MUBIT_API_KEY is not set' });

      const deadline = AbortSignal.timeout(timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
      const body = JSON.stringify({
        model,
        instructions: def.instructions,
        input: JSON.stringify(parsedInput.data),
        store: false,
        prompt_cache_key: opts.sessionId,
        temperature: def.temperature,
        max_output_tokens: def.maxOutputTokens,
        text: { format: { type: 'json_schema', name: task, strict: true, schema: schemaFor(def as unknown as TaskDef<TaskId>) } },
      });

      const asAbort = (e: unknown): MubitError | null => {
        if (opts.signal?.aborted) return new MubitError({ code: 'aborted', message: 'aborted by caller', requestId, cause: e });
        if (deadline.aborted) return new MubitError({ code: 'timeout', message: `timed out after ${timeoutMs} ms`, requestId, cause: e });
        return null;
      };

      let badOutputRetried = false;
      for (;;) {
        attempts += 1;
        let err: MubitError;
        try {
          const r = await semaphore.run(signal, () => attempt(task, attempts, body, signal));
          requestId = r.requestId ?? requestId;
          usage.input += r.body.usage?.input_tokens ?? 0;
          usage.output += r.body.usage?.output_tokens ?? 0;
          if (r.body.status === 'incomplete') {
            throw new MubitError({ code: 'bad_output', message: `answer incomplete: ${r.body.incomplete_details?.reason ?? 'unknown'}`, status: r.status, requestId: r.requestId });
          }
          const text = extractText(r.body, r.requestId);
          let raw: unknown;
          try {
            raw = JSON.parse(text);
          } catch {
            throw new MubitError({ code: 'bad_output', message: 'output_text is not valid JSON', status: r.status, requestId: r.requestId });
          }
          const parsed = def.output.safeParse(raw);
          if (!parsed.success) {
            const where = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
            throw new MubitError({ code: 'bad_output', message: `output does not match ${task} schema: ${where}`, status: r.status, requestId: r.requestId });
          }
          const value = parsed.data as TaskOutput<K>;
          const output = def.normalize ? def.normalize(value) : value;
          finish(true, null);
          return { output, requestId, latencyMs: now() - start, model, usage: { ...usage }, costUsd: costUsd(model, usage), attempts };
        } catch (e) {
          err = asAbort(e) ?? (e instanceof MubitError ? e : new MubitError({ code: 'network', message: String(e), retryable: true, cause: e }));
          if (err.requestId) requestId = err.requestId;
        }

        if (err.code === 'aborted' || err.code === 'timeout' || attempts >= MAX_ATTEMPTS) throw err;
        if (err.code === 'bad_output' && !badOutputRetried) {
          badOutputRetried = true;
          continue;
        }
        if (!err.retryable) throw err;
        const waitMs = err.retryAfterS !== null ? err.retryAfterS * 1000 : 250 * 2 ** (attempts - 1);
        if (now() + waitMs >= start + timeoutMs) throw err;
        try {
          await sleep(waitMs, signal);
        } catch (e) {
          throw asAbort(e) ?? err;
        }
      }
    } catch (e) {
      const err = e instanceof MubitError ? e : new MubitError({ code: 'http', message: String(e), cause: e });
      finish(false, err);
      throw err;
    }
  }

  async function ping(signal?: AbortSignal): Promise<boolean> {
    if (!config.configured) return false;
    const timeout = AbortSignal.timeout(5000);
    try {
      const res = await doFetch(`${config.baseUrl}/models`, { headers: { authorization: `Bearer ${config.apiKey}` }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      await res.body?.cancel();
      return res.ok;
    } catch {
      return false;
    }
  }

  return {
    config: Object.freeze({ ...config, models: { ...config.models } }),
    run,
    onCall(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stats: () => telemetry.stats(),
    modelFor,
    ping,
  };
}
