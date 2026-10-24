import { describe, expect, it, vi } from 'vitest';
import { interimGate } from '../src/capture/controller';
import { rmsLevel, smooth } from '../src/capture/levels';
import { UtteranceAssembler, type DeepgramResult } from '../src/capture/stt';
import { CueApiError } from '@cue/client';
import { sttCredentials } from '../src/background/stt';
import { FetchEventSource } from '../src/lib/fetch-event-source';

function streamOf(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('FetchEventSource (service-worker SSE)', () => {
  it('parses named events split across arbitrary chunks, skipping comments', async () => {
    const res = streamOf(['event: view\nid: 3\ndata: {"a"', ':1}\n\n: ping\n\n', 'event: event\r\nid: 4\r\ndata: {"b":2}\r\n\r\n']);
    const es = new FetchEventSource('http://x/stream', async () => res);
    const got: { type: string; data: string; id?: string }[] = [];
    es.addEventListener('view', (e) => got.push({ type: 'view', data: e.data, id: e.lastEventId }));
    es.addEventListener('event', (e) => got.push({ type: 'event', data: e.data, id: e.lastEventId }));
    const opened = vi.fn();
    const errored = vi.fn();
    es.onopen = opened;
    es.onerror = errored;
    for (let i = 0; i < 10; i++) await tick();
    expect(opened).toHaveBeenCalledOnce();
    expect(got).toEqual([
      { type: 'view', data: '{"a":1}', id: '3' },
      { type: 'event', data: '{"b":2}', id: '4' },
    ]);
    // The server closing the stream is an error, so subscribeCall reconnects.
    expect(errored).toHaveBeenCalledOnce();
  });

  it('reports a failed connect and stays silent after close()', async () => {
    const bad = new FetchEventSource('http://x/stream', async () => new Response('nope', { status: 401 }));
    const err = vi.fn();
    bad.onerror = err;
    await tick();
    await tick();
    expect(err).toHaveBeenCalledOnce();

    const closed = new FetchEventSource('http://x/stream', async () => streamOf(['event: view\ndata: 1\n\n']));
    const l = vi.fn();
    const e2 = vi.fn();
    closed.addEventListener('view', l);
    closed.onerror = e2;
    closed.close();
    for (let i = 0; i < 5; i++) await tick();
    expect(l).not.toHaveBeenCalled();
    expect(e2).not.toHaveBeenCalled();
  });
});

describe('Deepgram utterance assembly', () => {
  const r = (transcript: string, o: Partial<DeepgramResult> = {}): DeepgramResult => ({ type: 'Results', channel: { alternatives: [{ transcript }] }, start: 1, duration: 0.5, ...o });

  it('shows interims, accumulates finals, closes on speech_final', () => {
    let n = 0;
    const a = new UtteranceAssembler('prospect', 2_000, () => `turn_${++n}`);
    expect(a.push(r('what'))).toMatchObject({ id: 'turn_1', text: 'what', final: false, speaker: 'prospect', via: 'deepgram', tMs: 3_000 });
    expect(a.push(r("what's this", { is_final: true }))).toMatchObject({ text: "what's this", final: false });
    expect(a.push(r('regarding', { start: 1.6 }))).toMatchObject({ text: "what's this regarding", final: false });
    const done = a.push(r('regarding?', { is_final: true, speech_final: true, start: 1.6, duration: 0.6 }));
    expect(done).toMatchObject({ id: 'turn_1', text: "what's this regarding?", final: true, tMs: 3_000, durMs: 1_200 });
    expect(a.push(r('next'))?.id).toBe('turn_2');
  });

  it('closes on UtteranceEnd and ignores empty results', () => {
    const a = new UtteranceAssembler('prospect', 0, () => 't');
    expect(a.push(r(''))).toBeNull();
    a.push(r('send me an email', { is_final: true }));
    expect(a.push({ type: 'UtteranceEnd' })).toMatchObject({ text: 'send me an email', final: true });
    expect(a.push({ type: 'UtteranceEnd' })).toBeNull();
    expect(a.push({ type: 'Metadata' })).toBeNull();
  });
});

describe('capture helpers', () => {
  it('throttles interims per utterance but never finals', () => {
    let now = 0;
    const gate = interimGate(700, () => now);
    const t = (final: boolean, id = 'a') => ({ id, speaker: 'rep' as const, text: 'x', final, tMs: 0, via: 'webspeech' });
    expect(gate(t(false))).toBe(true);
    now = 300;
    expect(gate(t(false))).toBe(false);
    expect(gate(t(false, 'b'))).toBe(true);
    expect(gate(t(true))).toBe(true);
    now = 1_200;
    expect(gate(t(false))).toBe(true);
  });

  it('measures voice level', () => {
    expect(rmsLevel(new Uint8Array(512).fill(128))).toBe(0);
    const loud = Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 200 : 56));
    expect(rmsLevel(loud)).toBe(1);
    // Fast attack, slow release.
    expect(smooth(0, 1) - 0).toBeGreaterThan(1 - smooth(1, 0));
  });

  it('asks the server for a short-lived STT token, and treats a 404 or no server as not configured', async () => {
    const ok = { sttToken: vi.fn(async () => ({ provider: 'deepgram' as const, token: 'jwt', expiresAt: 5 })) };
    expect(await sttCredentials(ok)).toEqual({ provider: 'deepgram', token: 'jwt', expiresAt: 5 });
    const missing = { sttToken: vi.fn(async () => Promise.reject(new CueApiError('stt_not_configured', 404, 'No STT provider'))) };
    expect(await sttCredentials(missing)).toBeNull();
    const down = { sttToken: vi.fn(async () => Promise.reject(new CueApiError('network', 0, 'Failed to fetch'))) };
    expect(await sttCredentials(down)).toBeNull();
  });
});
