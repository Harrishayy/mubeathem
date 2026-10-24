import type { CallEvent, StreamMessage } from '@cue/core';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AppError, type Cue } from '../services/cue';

/** Open streams, so shutdown can close every one of them. */
export class StreamRegistry {
  private closers = new Set<() => void>();
  add(fn: () => void): () => void {
    this.closers.add(fn);
    return () => this.closers.delete(fn);
  }
  get size(): number {
    return this.closers.size;
  }
  closeAll(): void {
    for (const fn of [...this.closers]) fn();
    this.closers.clear();
  }
}

function parseSeq(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * `GET /api/calls/:id/stream`. Fresh connection: `event: view` (a StreamMessage with the CallView,
 * `id:` = its lastSeq) then one `event: event` per CallEvent (`id:` = seq). Resume (`Last-Event-ID`
 * header, or `?after=` for EventSource reconnects the client manages itself): only the events after
 * that seq, then live. Heartbeat comment every `heartbeatMs`. Subscribes before reading the backlog
 * and dedupes by seq, so nothing is lost or sent twice.
 */
export function streamCall(c: Context, cue: Cue, registry: StreamRegistry, heartbeatMs: number): Response {
  const callId = c.req.param('id') ?? '';
  const store = cue.s.store;
  if (!store.has(callId)) throw new AppError(404, 'not_found', `No call ${callId}`);
  const after = parseSeq(c.req.header('last-event-id')) ?? parseSeq(c.req.query('after'));
  c.header('cache-control', 'no-cache, no-transform');
  c.header('x-accel-buffering', 'no');

  return streamSSE(c, async (stream) => {
    const queue: CallEvent[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    const notify = () => {
      const w = wake;
      wake = null;
      w?.();
    };
    const unsubscribe = store.subscribe(callId, (e) => {
      queue.push(e);
      notify();
    });
    const close = () => {
      closed = true;
      notify();
    };
    const unregister = registry.add(close);
    stream.onAbort(close);
    const heartbeat = setInterval(() => {
      if (!closed) void stream.write(': ping\n\n').catch(close);
    }, heartbeatMs);

    const send = async (msg: StreamMessage, id: number) => {
      await stream.writeSSE({ event: msg.kind, id: String(id), data: JSON.stringify(msg) });
    };

    try {
      let lastSent: number;
      if (after === null) {
        const view = store.view(callId)!;
        lastSent = view.lastSeq;
        await send({ kind: 'view', view }, view.lastSeq);
      } else {
        lastSent = after;
        for (const event of store.list(callId, after)) {
          if (closed) break;
          await send({ kind: 'event', event }, event.seq);
          lastSent = event.seq;
        }
      }
      while (!closed) {
        while (queue.length && !closed) {
          const event = queue.shift()!;
          if (event.seq <= lastSent) continue;
          await send({ kind: 'event', event }, event.seq);
          lastSent = event.seq;
        }
        if (closed) break;
        await new Promise<void>((r) => {
          wake = r;
          if (queue.length || closed) notify();
        });
      }
    } catch {
      // client went away mid-write
    } finally {
      clearInterval(heartbeat);
      unsubscribe();
      unregister();
    }
  });
}
