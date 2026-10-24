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

  it('streams live_cue over the Responses API and reports fields as they finish', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const events = deltas(answer).map((d) => JSON.stringify({ type: 'response.output_text.delta', delta: d }));
      events.push(JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 700, output_tokens: 60 } } }));
      return new Response(sseBody(events), { status: 200, headers: { 'x-middleware-request-id': 'req_o1' } });
    }) as unknown as typeof globalThis.fetch;
    const client = createMubit(loadMubitConfig({ MUBIT_API_KEY: 'k' }), { fetch });
    const seen: Record<string, string>[] = [];
    const r = await client.stream('live_cue', INPUTS.live_cue, { sessionId: 'call_9', onFields: (f) => seen.push({ ...f }) });

    expect(calls[0]!.url).toBe('https://api.mubit.ai/openai/v1/responses');
    expect(r.output.say).toBe(OUTPUTS.live_cue.say);
    expect(r.model).toBe('gpt-4.1-mini');
    expect(r.requestId).toBe('req_o1');
    expect(r.usage).toEqual({ input: 700, output: 60 });
    expect(calls[0]!.body.stream).toBe(true);
    expect(calls[0]!.body.prompt_cache_key).toBe('call_9');
    expect(calls[0]!.body.instructions).toContain('You are Cue');
    // Fields arrive in schema order: the read before the line.
    const firstWithSay = seen.findIndex((f) => 'say' in f);
    expect(firstWithSay).toBeGreaterThan(0);
    expect(seen[firstWithSay]!.meaning).toBe(OUTPUTS.live_cue.meaning);
  });

  it('fails with a clear error when the stream is not valid JSON, and records the call', async () => {
    const fetch = (async () => new Response(sseBody([JSON.stringify({ type: 'response.output_text.delta', delta: '{"meaning":"x",' })]), { status: 200 })) as unknown as typeof globalThis.fetch;
    const client = createMubit(loadMubitConfig({ MUBIT_API_KEY: 'k' }), { fetch });
    const events: { ok: boolean; task: string }[] = [];
    client.onCall((e) => events.push(e));
    await expect(client.stream('live_cue', INPUTS.live_cue, { sessionId: 'c' })).rejects.toMatchObject({ code: 'bad_output' });
    expect(events).toEqual([expect.objectContaining({ ok: false, task: 'live_cue' })]);
  });
});

describe('createMubit · embed', () => {
  it('posts to /embeddings and returns vectors in input order', async () => {
    let body: Record<string, unknown> = {};
    const fetch = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.mubit.ai/openai/v1/embeddings');
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const client = createMubit(loadMubitConfig({ MUBIT_API_KEY: 'k' }), { fetch });
    expect(await client.embed(['a', 'b'])).toEqual([[1, 0], [0, 1]]);
    expect(body).toEqual({ model: 'text-embedding-3-small', input: ['a', 'b'] });
  });

  it('times out instead of waiting on a slow answer', async () => {
    const fetch = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof globalThis.fetch;
    const client = createMubit(loadMubitConfig({ MUBIT_API_KEY: 'k' }), { fetch });
    await expect(client.embed(['a'], { timeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' });
  });
});
