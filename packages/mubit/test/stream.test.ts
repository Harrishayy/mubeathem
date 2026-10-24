import { describe, expect, it } from 'vitest';
import { completedFields, createMubit, loadMubitConfig, readSse } from '../src';
import { INPUTS, OUTPUTS } from './fixtures';

function sseBody(events: string[], chunkSize = 7): ReadableStream<Uint8Array> {
  const text = events.map((e) => `data: ${e}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + chunkSize));
      i += chunkSize;
    },
  });
}

/** Splits a JSON string into small deltas, the way a model streams it. */
function deltas(json: string, size = 9): string[] {
  const out: string[] = [];
  for (let i = 0; i < json.length; i += size) out.push(json.slice(i, i + size));
  return out;
}

describe('completedFields', () => {
  it('returns only the top-level strings that are closed', () => {
    expect(completedFields('{"meaning":"busy","say":"Fair en')).toEqual({ meaning: 'busy' });
    expect(completedFields('{"a":"x \\"q\\"","b":')).toEqual({ a: 'x "q"' });
  });
  it('skips nested values so a nested key never shadows a top-level one', () => {
    const t = '{"moment":"opener","up_next":[{"moment":"close","move":"x"}],"risky_claim":null,"why":"ok"}';
    expect(completedFields(t)).toEqual({ moment: 'opener', why: 'ok' });
  });
  it('is empty before the object starts', () => {
    expect(completedFields('')).toEqual({});
    expect(completedFields('  {')).toEqual({});
  });
});

describe('readSse', () => {
  it('reads data lines across arbitrary chunk boundaries', async () => {
    const got: string[] = [];
    await readSse(sseBody(['{"a":1}', '{"b":2}', '[DONE]'], 3), (d) => got.push(d));
    expect(got).toEqual(['{"a":1}', '{"b":2}', '[DONE]']);
  });
});

describe('createMubit · stream', () => {
  const answer = JSON.stringify(OUTPUTS.live_cue);

  it('streams live_cue over the Gemini route and reports fields as they finish', async () => {
    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      const events = deltas(answer).map((t) => JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }));
      events.push(JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 80 } }));
      return new Response(sseBody(events), { status: 200, headers: { 'x-middleware-request-id': 'req_g1' } });
    }) as unknown as typeof globalThis.fetch;
    const client = createMubit(loadMubitConfig({ MUBIT_API_KEY: 'k' }), { fetch });
    const seen: Record<string, string>[] = [];
    const r = await client.stream('live_cue', INPUTS.live_cue, { sessionId: 'call_1', onFields: (f) => seen.push({ ...f }) });

    expect(r.output.say).toBe(OUTPUTS.live_cue.say);
    expect(r.requestId).toBe('req_g1');
    expect(r.usage).toEqual({ input: 900, output: 80 });
    expect(calls[0]!.url).toBe('https://api.mubit.ai/gemini/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    expect(calls[0]!.headers['x-goog-api-key']).toBe('k');
    expect((calls[0]!.body.system_instruction as { parts: { text: string }[] }).parts[0]!.text).toContain('You are Cue');
    // Fields arrive in schema order: the read before the line.
    const firstWithSay = seen.findIndex((f) => 'say' in f);
    expect(firstWithSay).toBeGreaterThan(0);
    expect(seen[firstWithSay]!.meaning).toBe(OUTPUTS.live_cue.meaning);
  });

  it('drops an option the Gemini model refuses and tries once more', async () => {
    let n = 0;
    const bodies: Record<string, unknown>[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (n++ === 0) return new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Thinking level is not supported for this model.' } }), { status: 400 });
      return new Response(sseBody([JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] }, finishReason: 'STOP' }] })]), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const client = createMubit(loadMubitConfig({ MUBIT_API_KEY: 'k' }), { fetch });
    const r = await client.stream('live_cue', INPUTS.live_cue, { sessionId: 'call_1' });
    expect(r.attempts).toBe(2);
    expect((bodies[0]!.generationConfig as Record<string, unknown>).thinkingConfig).toBeDefined();
    expect((bodies[1]!.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
  });

  it('streams over the Responses API when the live provider is openai', async () => {
    let body: Record<string, unknown> = {};
    const fetch = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.mubit.ai/openai/v1/responses');
      body = JSON.parse(String(init.body));
      const events = deltas(answer).map((d) => JSON.stringify({ type: 'response.output_text.delta', delta: d }));
      events.push(JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 700, output_tokens: 60 } } }));
      return new Response(sseBody(events), { status: 200, headers: { 'x-middleware-request-id': 'req_o1' } });
    }) as unknown as typeof globalThis.fetch;
    const client = createMubit(loadMubitConfig({ MUBIT_API_KEY: 'k', CUE_LIVE_PROVIDER: 'openai', CUE_LIVE_MODEL: 'gpt-4.1-nano' }), { fetch });
    const r = await client.stream('live_cue', INPUTS.live_cue, { sessionId: 'call_9' });
    expect(r.output.moment).toBe('whats_this_regarding');
    expect(r.model).toBe('gpt-4.1-nano');
    expect(body.stream).toBe(true);
    expect(body.prompt_cache_key).toBe('call_9');
    expect(r.usage).toEqual({ input: 700, output: 60 });
  });

  it('fails with a clear error when the stream is not valid JSON, and records the call', async () => {
    const fetch = (async () => new Response(sseBody([JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"meaning":"x",' }] }, finishReason: 'MAX_TOKENS' }] })]), { status: 200 })) as unknown as typeof globalThis.fetch;
    const client = createMubit(loadMubitConfig({ MUBIT_API_KEY: 'k' }), { fetch });
    const events: { ok: boolean; task: string }[] = [];
    client.onCall((e) => events.push(e));
    await expect(client.stream('live_cue', INPUTS.live_cue, { sessionId: 'c' })).rejects.toMatchObject({ code: 'bad_output' });
    expect(events).toEqual([expect.objectContaining({ ok: false, task: 'live_cue' })]);
  });
});
