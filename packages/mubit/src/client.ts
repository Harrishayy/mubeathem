import { TASK_INPUT, type TaskId, type TaskInput, type TaskOutput, type TaskStats } from '@cue/core';
import type { MubitConfig } from './config';
import { MubitError } from './errors';
import { Semaphore } from './semaphore';
import { completedFields, readSse } from './stream';
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

export interface StreamOptions extends RunOptions {
  /** Called each time another top-level string field of the answer is complete, with all complete fields so far. */
  onFields?: (fields: Record<string, string>) => void;
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
  /**
   * The same task, streamed: one attempt, no queue (the live path can't wait behind a review), and
   * `onFields` as the answer is written. live_cue goes to the configured live provider.
   */
  stream<K extends TaskId>(task: K, input: TaskInput<K>, opts: StreamOptions): Promise<TaskResult<K>>;
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

/** A non-2xx answer as a MubitError, with Mubit's own code and retry hints when it sent them. */
function httpError(res: Response, text: string, requestId: string | null, now: number): MubitError {
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const raw = (json as { error?: { code?: string | number; status?: string; message?: string } } | null)?.error;
  const shouldRetry = res.headers.get('x-should-retry');
  const retryable = shouldRetry === 'false' ? false : shouldRetry === 'true' ? true : RETRYABLE_STATUS.has(res.status);
  const code = typeof raw?.code === 'string' && raw.code ? raw.code : raw?.status || 'http';
  return new MubitError({ code, message: raw?.message || text.slice(0, 300) || `HTTP ${res.status}`, status: res.status, retryable, requestId, retryAfterS: parseRetryAfter(res.headers.get('retry-after'), now) });
}

interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
}

interface ResponsesEvent {
  type?: string;
  delta?: string;
  response?: ResponsesBody & { error?: { code?: string; message?: string } | null };
  error?: { code?: string; message?: string } | null;
  message?: string;
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

  // Options a Gemini model refused once (thinking level, response schema) are not sent to it again.
  const geminiQuirks = new Map<string, { noThinking?: boolean; noSchema?: boolean }>();

  async function post(task: TaskId, url: string, h: Record<string, string>, shown: Record<string, string>, body: string, signal: AbortSignal) {
    deps.debug?.({ kind: 'request', task, attempt: 1, url, headers: shown });
    let res: Response;
    try {
      res = await doFetch(url, { method: 'POST', headers: h, body, signal });
    } catch (e) {
      if (signal.aborted) throw signal.reason;
      throw new MubitError({ code: 'network', message: `network error: ${e instanceof Error ? e.message : String(e)}`, retryable: true, cause: e });
    }
    const requestId = res.headers.get('x-middleware-request-id');
    deps.debug?.({ kind: 'response', task, attempt: 1, url, status: res.status, requestId });
    return { res, requestId };
  }

  /** Reasoning models (gpt-5.x, gpt-6.x, o-series) take no temperature; the live path asks them to think as little as possible. */
  const reasoning = (model: string) => /^(gpt-5|gpt-6|o\d)/.test(model);

  /** One streamed attempt over the Responses API. */
  async function openaiStream(task: TaskId, def: TaskDef<TaskId>, model: string, input: string, sessionId: string, signal: AbortSignal, onText: (d: string) => void) {
    const h = headers();
    const body = JSON.stringify({
      model,
      instructions: def.instructions,
      input,
      store: false,
      stream: true,
      prompt_cache_key: sessionId,
      ...(reasoning(model) ? { reasoning: { effort: config.live.reasoningEffort } } : { temperature: def.temperature }),
      max_output_tokens: def.maxOutputTokens + (reasoning(model) ? 512 : 0),
      text: { format: { type: 'json_schema', name: task, strict: true, schema: schemaFor(def) } },
    });
    const { res, requestId } = await post(task, `${config.baseUrl}/responses`, h, redactHeaders(h), body, signal);
    if (!res.ok || !res.body) throw httpError(res, await res.text().catch(() => ''), requestId, now());
    const usage = { input: 0, output: 0 };
    let failure: MubitError | null = null;
    await readSse(res.body, (data) => {
      if (data === '[DONE]') return;
      let e: ResponsesEvent;
      try {
        e = JSON.parse(data) as ResponsesEvent;
      } catch {
        return;
      }
      if (e.type === 'response.output_text.delta' && typeof e.delta === 'string') onText(e.delta);
      else if (e.type === 'response.completed' || e.type === 'response.incomplete') {
        usage.input = e.response?.usage?.input_tokens ?? 0;
        usage.output = e.response?.usage?.output_tokens ?? 0;
      } else if (e.type === 'response.failed' || e.type === 'error') {
        failure ??= new MubitError({ code: e.response?.error?.code || e.error?.code || 'http', message: e.response?.error?.message || e.error?.message || e.message || 'stream failed', status: res.status, requestId });
      }
    });
    if (failure) throw failure;
    return { requestId, usage };
  }

  /** One streamed attempt over Mubit's Gemini route. A refused option comes back as `option_refused`, dropped for next time. */
  async function geminiStream(task: TaskId, def: TaskDef<TaskId>, model: string, input: string, signal: AbortSignal, onText: (d: string) => void) {
    const quirks = geminiQuirks.get(model) ?? {};
    const h: Record<string, string> = { 'x-goog-api-key': config.apiKey, 'content-type': 'application/json' };
    if (config.record === 'metadata') h['x-middleware-record'] = 'metadata';
    const generationConfig: Record<string, unknown> = { temperature: def.temperature, maxOutputTokens: def.maxOutputTokens, responseMimeType: 'application/json' };
    if (!quirks.noSchema) generationConfig.responseJsonSchema = schemaFor(def);
    if (!quirks.noThinking) generationConfig.thinkingConfig = { thinkingLevel: 'MINIMAL' };
    const body = JSON.stringify({ system_instruction: { parts: [{ text: def.instructions }] }, contents: [{ role: 'user', parts: [{ text: input }] }], generationConfig });
    const url = `${config.live.geminiBaseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const { res, requestId } = await post(task, url, h, { ...h, 'x-goog-api-key': '[redacted]' }, body, signal);
    if (!res.ok || !res.body) {
      const err = httpError(res, await res.text().catch(() => ''), requestId, now());
      if (res.status === 400 && (!quirks.noThinking || !quirks.noSchema)) {
        const next = { ...quirks };
        if (!quirks.noThinking && (err.message.toLowerCase().includes('think') || quirks.noSchema)) next.noThinking = true;
        else if (!quirks.noSchema) next.noSchema = true;
        else next.noThinking = true;
        geminiQuirks.set(model, next);
        throw new MubitError({ code: 'option_refused', message: err.message, status: 400, retryable: true, requestId });
      }
      throw err;
    }
    const usage = { input: 0, output: 0 };
    let failure: MubitError | null = null;
    await readSse(res.body, (data) => {
      let c: GeminiChunk;
      try {
        c = JSON.parse(data) as GeminiChunk;
      } catch {
        return;
      }
      if (c.error) failure ??= new MubitError({ code: c.error.status || 'http', message: c.error.message || 'stream failed', status: c.error.code ?? res.status, requestId });
      for (const part of c.candidates?.[0]?.content?.parts ?? []) if (!part.thought && typeof part.text === 'string') onText(part.text);
      if (c.usageMetadata) {
        usage.input = c.usageMetadata.promptTokenCount ?? usage.input;
        usage.output = (c.usageMetadata.candidatesTokenCount ?? 0) + (c.usageMetadata.thoughtsTokenCount ?? 0) || usage.output;
      }
      const reason = c.candidates?.[0]?.finishReason;
      if (reason && reason !== 'STOP' && reason !== 'MAX_TOKENS') failure ??= new MubitError({ code: 'refused', message: `answer stopped: ${reason}`, status: res.status, requestId });
    });
    if (failure) throw failure;
    return { requestId, usage };
  }

  async function stream<K extends TaskId>(task: K, input: TaskInput<K>, opts: StreamOptions): Promise<TaskResult<K>> {
    const start = now();
    const def = TASKS[task] as unknown as TaskDef<TaskId>;
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
      const provider = def.tier === 'live' ? config.live.provider : 'openai';
      const inputJson = JSON.stringify(parsedInput.data);
      let text = '';
      let seen = 0;
      const onText = (delta: string) => {
        text += delta;
        if (!opts.onFields) return;
        const fields = completedFields(text);
        const count = Object.keys(fields).length;
        if (count <= seen) return;
        seen = count;
        try {
          opts.onFields(fields);
        } catch {
          /* a listener never breaks the stream */
        }
      };
      try {
        for (;;) {
          attempts += 1;
          text = '';
          seen = 0;
          try {
            const r = provider === 'gemini' ? await geminiStream(task, def, model, inputJson, signal, onText) : await openaiStream(task, def, model, inputJson, opts.sessionId, signal, onText);
            requestId = r.requestId ?? requestId;
            usage.input += r.usage.input;
            usage.output += r.usage.output;
            break;
          } catch (e) {
            if (e instanceof MubitError && e.requestId) requestId = e.requestId;
            // Only a refused option is retried (with it dropped); any other retry would cost the live window.
            if (e instanceof MubitError && e.code === 'option_refused' && attempts < MAX_ATTEMPTS) continue;
            throw e;
          }
        }
      } catch (e) {
        if (opts.signal?.aborted) throw new MubitError({ code: 'aborted', message: 'aborted by caller', requestId, cause: e });
        if (deadline.aborted) throw new MubitError({ code: 'timeout', message: `timed out after ${timeoutMs} ms`, requestId, cause: e });
        throw e instanceof MubitError ? e : new MubitError({ code: 'network', message: String(e), retryable: true, cause: e });
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new MubitError({ code: 'bad_output', message: 'streamed answer is not valid JSON', status: 200, requestId });
      }
      const parsed = def.output.safeParse(raw);
      if (!parsed.success) {
        const where = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        throw new MubitError({ code: 'bad_output', message: `output does not match ${task} schema: ${where}`, status: 200, requestId });
      }
      const value = parsed.data as TaskOutput<K>;
      const output = def.normalize ? (def as unknown as TaskDef<K>).normalize!(value) : value;
      finish(true, null);
      return { output, requestId, latencyMs: now() - start, model, usage: { ...usage }, costUsd: costUsd(model, usage), attempts };
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
    config: Object.freeze({ ...config, models: { ...config.models }, live: { ...config.live } }),
    run,
    stream,
    onCall(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stats: () => telemetry.stats(),
    modelFor,
    ping,
  };
}
