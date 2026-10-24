import { StreamMessage } from '@cue/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { CueServer } from '../src/boot';
import { createCall, post, testServer } from './helpers';

let server: CueServer;
afterEach(async () => server && (await server.close()));

interface Frame {
  event?: string;
  id?: string;
  data?: string;
  comment?: string;
}

/** Reads SSE frames from a Response until `until` says stop or the timeout passes. */
async function readFrames(res: Response, until: (frames: Frame[]) => boolean, timeoutMs = 2000): Promise<Frame[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const frames: Frame[] = [];
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (!until(frames) && Date.now() < deadline) {
      const r = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((ok) => setTimeout(() => ok({ done: true, value: undefined }), Math.max(1, deadline - Date.now())))]);
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const f: Frame = {};
        for (const line of raw.split('\n')) {
          if (line.startsWith(':')) f.comment = line.slice(1).trim();
          else if (line.startsWith('event: ')) f.event = line.slice(7);
          else if (line.startsWith('id: ')) f.id = line.slice(4);
          else if (line.startsWith('data: ')) f.data = (f.data ? f.data + '\n' : '') + line.slice(6);
        }
        frames.push(f);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return frames;
}

const messages = (frames: Frame[]) => frames.filter((f) => f.data).map((f) => StreamMessage.parse(JSON.parse(f.data!)));

describe('SSE /api/calls/:id/stream', () => {
  it('sends the view snapshot first, then events in seq order', async () => {
    server = testServer();
    const id = await createCall(server);
    await server.cue.idle();
    const res = await server.app.request(`/api/calls/${id}/stream`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // The instant card can land before the model's situation.read (architecture.md §5.3): wait for both.
    const has = (fs: Frame[], type: string) => fs.some((f) => f.event === 'event' && f.data?.includes(type));
    const reading = readFrames(res, (fs) => has(fs, 'suggestion.shown') && has(fs, 'situation.read'));
    await new Promise((r) => setTimeout(r, 20));
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "What's this regarding?" });
    const frames = await reading;
    const msgs = messages(frames);
    expect(msgs[0]!.kind).toBe('view');
    const snapshotSeq = msgs[0]!.kind === 'view' ? msgs[0]!.view.lastSeq : -1;
    expect(frames[0]!.id).toBe(String(snapshotSeq));
    const seqs = msgs.flatMap((m) => (m.kind === 'event' ? [m.event.seq] : []));
    expect(seqs.length).toBeGreaterThan(2);
    expect(seqs[0]).toBe(snapshotSeq + 1);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const types = msgs.flatMap((m) => (m.kind === 'event' ? [m.event.type] : []));
    expect(types).toContain('turn.added');
    expect(types).toContain('situation.read');
  });

  it('resumes from Last-Event-ID (and ?after=) with only the missed events, no snapshot', async () => {
    server = testServer();
    const id = await createCall(server);
    await post(server, `/api/calls/${id}/turns`, { speaker: 'prospect', text: "What's this regarding?" });
    await server.cue.idle();
    const all = server.cue.s.store.list(id);
    const from = 2;
    for (const req of [
      server.app.request(`/api/calls/${id}/stream`, { headers: { 'last-event-id': String(from) } }),
      server.app.request(`/api/calls/${id}/stream?after=${from}`),
    ]) {
      const frames = await readFrames(await req, (fs) => fs.filter((f) => f.data).length >= all.length - from, 1000);
      const msgs = messages(frames);
      expect(msgs.every((m) => m.kind === 'event')).toBe(true);
      expect(msgs.map((m) => (m.kind === 'event' ? m.event.seq : 0))).toEqual(all.filter((e) => e.seq > from).map((e) => e.seq));
    }
  });

  it('sends heartbeat comments and cleans up its subscription on abort', async () => {
    server = testServer({ config: { heartbeatMs: 30 } });
    const id = await createCall(server);
    await server.cue.idle();
    const res = await server.app.request(`/api/calls/${id}/stream`);
    const frames = await readFrames(res, (fs) => fs.filter((f) => f.comment === 'ping').length >= 2, 1000);
    expect(frames.filter((f) => f.comment === 'ping').length).toBeGreaterThanOrEqual(2);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.streams.size).toBe(0);
  });

  it('404s for an unknown call', async () => {
    server = testServer();
    expect((await server.app.request('/api/calls/call_nope/stream')).status).toBe(404);
  });
});
