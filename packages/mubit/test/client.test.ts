import type { TaskId } from '@cue/core';
import { describe, expect, it, vi } from 'vitest';
import { createMubit, redactHeaders, type MubitDebugEvent } from '../src/client';
import { loadMubitConfig, type MubitConfig } from '../src/config';
import { MubitError } from '../src/errors';
import { TASKS } from '../src/tasks';
import type { CallRecordEvent } from '../src/telemetry';
import { INPUTS, OUTPUTS } from './fixtures';

const KEY = 'mbt_test_secret_key_123';
const config = (over: Partial<MubitConfig> = {}): MubitConfig => ({ ...loadMubitConfig({ MUBIT_API_KEY: KEY }), ...over });

let seq = 0;
function rid() {
  seq += 1;
  return `mreq_${seq.toString(16).padStart(32, '0')}`;
}

function answer(task: TaskId, output: unknown = OUTPUTS[task], init: { text?: string; status?: string } = {}): Response {
  const body = {
    id: 'resp_1',
    object: 'response',
    status: init.status ?? 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: init.text ?? JSON.stringify(output) }] }],
    usage: { input_tokens: 1000, output_tokens: 100 },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'x-middleware-request-id': rid() } });
}

function gatewayError(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message: `${code} happened`, type: 'middleware_gateway_error' } }), {
    status,
    headers: { 'content-type': 'application/json', 'x-middleware-request-id': rid(), ...headers },
  });
}

type FakeFetch = (url: string, init: RequestInit) => Promise<Response>;
const asFetch = (f: FakeFetch) => vi.fn(f) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

const opts = { sessionId: 'call_test_1' };

describe('createMubit · request', () => {
  it('sends a Responses call with store false, the session as prompt_cache_key, fixed instructions and a strict schema', async () => {
    const f = asFetch(async () => answer('read_moment'));
    const client = createMubit(config(), { fetch: f });
    const res = await client.run('read_moment', INPUTS.read_moment, opts);

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.mubit.ai/openai/v1/responses');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers['x-middleware-record']).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'gpt-4o-mini', store: false, prompt_cache_key: 'call_test_1', instructions: TASKS.read_moment.instructions, temperature: 0 });
    expect(body.metadata).toBeUndefined();
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'read_moment', strict: true });
    expect(body.text.format.schema.additionalProperties).toBe(false);
    expect(JSON.parse(body.input)).toEqual(INPUTS.read_moment);

    expect(res.output.moment).toBe('gatekeeper');
    expect(res.requestId).toMatch(/^mreq_[0-9a-f]{32}$/);
    expect(res.model).toBe('gpt-4o-mini');
    expect(res.attempts).toBe(1);
    expect(res.usage).toEqual({ input: 1000, output: 100 });
    expect(res.costUsd).toBeCloseTo((1000 * 0.15 + 100 * 0.6) / 1e6, 12);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('uses the write model for write tasks and sends x-middleware-record: metadata when configured', async () => {
    const f = asFetch(async () => answer('write_line'));
    const client = createMubit(config({ record: 'metadata' }), { fetch: f });
    const res = await client.run('write_line', INPUTS.write_line, opts);
    const init = f.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-middleware-record']).toBe('metadata');
    expect(JSON.parse(init.body as string).model).toBe('gpt-4.1-mini');
    expect(res.model).toBe('gpt-4.1-mini');
  });

  it('sends identical instructions and schema on every call of a task, whatever the input', async () => {
    const f = asFetch(async () => answer('write_line'));
    const client = createMubit(config(), { fetch: f });
    await client.run('write_line', INPUTS.write_line, opts);
    await client.run('write_line', { ...INPUTS.write_line, prospect: { name: 'Sam Ortiz', title: 'CFO', company: 'Northwind' } }, { sessionId: 'call_2' });
    const [a, b] = f.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(a.instructions).toBe(b.instructions);
    expect(a.text).toEqual(b.text);
    expect(a.prompt_cache_key).not.toBe(b.prompt_cache_key);
  });
});

describe('createMubit · validation', () => {
  it('rejects bad input without a network call', async () => {
    const f = asFetch(async () => answer('read_moment'));
    const client = createMubit(config(), { fetch: f });
    const bad = { ...INPUTS.read_moment, previous: { persona: 'ceo', receptivity: 'lukewarm', moment: 'opener' } };
    await expect(client.run('read_moment', bad as never, opts)).rejects.toMatchObject({ code: 'bad_input' });
    await expect(client.run('read_moment', INPUTS.read_moment, { sessionId: '' })).rejects.toMatchObject({ code: 'bad_input' });
    expect(f).not.toHaveBeenCalled();
  });

  it('fails fast with not_configured when there is no key', async () => {
    const f = asFetch(async () => answer('read_moment'));
    const client = createMubit(loadMubitConfig({}), { fetch: f });
    expect(client.config.configured).toBe(false);
    await expect(client.run('read_moment', INPUTS.read_moment, opts)).rejects.toMatchObject({ code: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });

  it('retries a malformed answer once, then succeeds', async () => {
    const responses = [answer('read_moment', null, { text: '{"persona": "ceo", trunc' }), answer('read_moment')];
    const f = asFetch(async () => responses.shift()!);
    const res = await createMubit(config(), { fetch: f }).run('read_moment', INPUTS.read_moment, opts);
    expect(f).toHaveBeenCalledTimes(2);
    expect(res.attempts).toBe(2);
    expect(res.usage.input).toBe(2000);
  });

  it('gives up with bad_output after the second unparseable or off-schema answer', async () => {
    const f = asFetch(async () => answer('read_moment', { ...OUTPUTS.read_moment, moment: 'not_a_moment' }));
    const err = await createMubit(config(), { fetch: f })
      .run('read_moment', INPUTS.read_moment, opts)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MubitError);
    expect(err).toMatchObject({ code: 'bad_output', retryable: false });
    expect((err as MubitError).requestId).toMatch(/^mreq_/);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('treats an incomplete answer (max tokens) as bad_output', async () => {
    const f = asFetch(async () => answer('read_moment', null, { text: '{"persona":', status: 'incomplete' }));
    await expect(createMubit(config(), { fetch: f }).run('read_moment', INPUTS.read_moment, opts)).rejects.toMatchObject({ code: 'bad_output' });
  });

  it('reports a refusal as refused without retrying', async () => {
    const f = asFetch(async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }), { status: 200 }));
    await expect(createMubit(config(), { fetch: f }).run('check_claim', INPUTS.check_claim, opts)).rejects.toMatchObject({ code: 'refused' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('createMubit · errors and retries', () => {
  it('waits retry-after on 429 starter_credit_busy, then succeeds', async () => {
    const responses = [gatewayError(429, 'starter_credit_busy', { 'retry-after': '0.05' }), answer('check_claim')];
    const f = asFetch(async () => responses.shift()!);
    const t0 = Date.now();
    const res = await createMubit(config(), { fetch: f }).run('check_claim', INPUTS.check_claim, opts);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
    expect(res.attempts).toBe(2);
    expect(res.output.verdict).toBe('violation');
  });

  it('stops after two retries', async () => {
    const f = asFetch(async () => gatewayError(503, 'gateway_overloaded', { 'retry-after': '0' }));
    await expect(createMubit(config(), { fetch: f }).run('check_claim', INPUTS.check_claim, opts)).rejects.toMatchObject({ code: 'gateway_overloaded', status: 503 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 400 with x-should-retry: false, and keeps the gateway code and request id', async () => {
    const f = asFetch(async () => gatewayError(400, 'starter_credit_option', { 'x-should-retry': 'false' }));
    const err = (await createMubit(config(), { fetch: f })
      .run('check_claim', INPUTS.check_claim, opts)
      .catch((e: unknown) => e)) as MubitError;
    expect(err).toMatchObject({ code: 'starter_credit_option', status: 400, retryable: false });
    expect(err.requestId).toMatch(/^mreq_/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 429 whose retry-after would overrun the deadline', async () => {
    const f = asFetch(async () => gatewayError(429, 'starter_credit_busy', { 'retry-after': '30' }));
    await expect(createMubit(config({ timeoutMs: 1000 }), { fetch: f }).run('check_claim', INPUTS.check_claim, opts)).rejects.toMatchObject({ code: 'starter_credit_busy' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries a network error', async () => {
    let n = 0;
    const f = asFetch(async () => {
      n += 1;
      if (n === 1) throw new TypeError('fetch failed');
      return answer('simulate_prospect');
    });
    const res = await createMubit(config(), { fetch: f }).run('simulate_prospect', INPUTS.simulate_prospect, opts);
    expect(res.attempts).toBe(2);
  });

  it('times out a hung call', async () => {
    const f = asFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const t0 = Date.now();
    await expect(createMubit(config(), { fetch: f }).run('read_moment', INPUTS.read_moment, { ...opts, timeoutMs: 60 })).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('stops when the caller aborts', async () => {
    const f = asFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const ac = new AbortController();
    const p = createMubit(config(), { fetch: f }).run('read_moment', INPUTS.read_moment, { ...opts, signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ code: 'aborted', retryable: false });
  });
});

describe('createMubit · concurrency and telemetry', () => {
  it('never has more calls in flight than config.concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const f = asFetch(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight -= 1;
      return answer('read_moment');
    });
    const client = createMubit(config({ concurrency: 2 }), { fetch: f });
    const results = await Promise.all(Array.from({ length: 7 }, (_, i) => client.run('read_moment', INPUTS.read_moment, { sessionId: `call_${i % 3}` })));
    expect(results).toHaveLength(7);
    expect(peak).toBe(2);
    expect(f).toHaveBeenCalledTimes(7);
  });

  it('emits every finished call to listeners and keeps per-task stats', async () => {
    const responses = [answer('read_moment'), gatewayError(400, 'starter_credit_model', { 'x-should-retry': 'false' })];
    const f = asFetch(async () => responses.shift()!);
    const client = createMubit(config(), { fetch: f });
    const events: CallRecordEvent[] = [];
    const off = client.onCall((e) => events.push(e));
    client.onCall(() => {
      throw new Error('listener bug');
    });
    await client.run('read_moment', INPUTS.read_moment, { sessionId: 'call_a' });
    await client.run('read_moment', INPUTS.read_moment, { sessionId: 'call_b' }).catch(() => undefined);
    off();

    expect(events.map((e) => [e.ok, e.error?.code ?? null])).toEqual([
      [true, null],
      [false, 'starter_credit_model'],
    ]);
    expect(events[0]!.requestId).toMatch(/^mreq_/);
    const stats = client.stats();
    expect(stats.map((s) => s.task)).toEqual(['read_moment', 'write_line', 'research_brief', 'check_claim', 'review_call', 'simulate_prospect']);
    const rm = stats[0]!;
    expect(rm).toMatchObject({ calls: 2, ok: 1, failed: 1, sessions: 2, inputTokens: 1000, outputTokens: 100, adapterThreshold: 25, model: 'gpt-4o-mini' });
    expect(rm.lastRequestId).toBe(events[1]!.requestId);
    expect(stats[1]).toMatchObject({ calls: 0, model: 'gpt-4.1-mini', lastRequestId: null });
  });
});

describe('secrets', () => {
  it('never hands the key to the debug hook', async () => {
    const seen: MubitDebugEvent[] = [];
    const f = asFetch(async () => answer('read_moment'));
    await createMubit(config(), { fetch: f, debug: (e) => seen.push(e) }).run('read_moment', INPUTS.read_moment, opts);
    expect(seen.map((e) => e.kind)).toEqual(['request', 'response']);
    expect(JSON.stringify(seen)).not.toContain(KEY);
    expect(redactHeaders({ Authorization: `Bearer ${KEY}` }).Authorization).toBe('Bearer [redacted]');
  });

  it('never puts the key in an error', async () => {
    const f = asFetch(async () => gatewayError(401, 'key_invalid', { 'x-should-retry': 'false' }));
    const err = (await createMubit(config(), { fetch: f })
      .run('read_moment', INPUTS.read_moment, opts)
      .catch((e: unknown) => e)) as MubitError;
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain(KEY);
  });
});

describe('loadMubitConfig', () => {
  it('reads the environment with safe defaults', () => {
    expect(loadMubitConfig({})).toMatchObject({ configured: false, baseUrl: 'https://api.mubit.ai/openai/v1', models: { fast: 'gpt-4o-mini', write: 'gpt-4.1-mini' }, concurrency: 4, timeoutMs: 12000, record: 'full' });
    expect(
      loadMubitConfig({ MUBIT_API_KEY: ' k ', MUBIT_BASE_URL: 'http://x/v1/', CUE_MUBIT_CONCURRENCY: '2', CUE_MUBIT_TIMEOUT_MS: 'nope', CUE_MUBIT_RECORD: 'METADATA', CUE_MODEL_FAST: 'gpt-4.1-mini' }),
    ).toMatchObject({ apiKey: 'k', configured: true, baseUrl: 'http://x/v1', concurrency: 2, timeoutMs: 12000, record: 'metadata', models: { fast: 'gpt-4.1-mini' } });
  });
});
