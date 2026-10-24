import { newId, type AddTurnRequest } from '@cue/core';
import type { z } from 'zod';
import { CueApiError } from './api';

export type TurnInput = z.input<typeof AddTurnRequest>;
type QueuedTurn = TurnInput & { id: string };

interface Item {
  callId: string;
  turn: QueuedTurn;
}

export interface TurnBufferOptions {
  /** Usually `(callId, turn) => api.addTurn(callId, turn)`. */
  send(callId: string, turn: QueuedTurn): Promise<unknown>;
  /** Default: no answer, timeout, 429 or 5xx. Anything else is dropped (and reported). */
  isRetryable?(error: unknown): boolean;
  minRetryMs?: number;
  maxRetryMs?: number;
  /** Oldest turns are dropped past this (interims first). Default 500. */
  maxSize?: number;
  onChange?(state: { pending: number; offline: boolean }): void;
  onDrop?(item: { callId: string; turn: QueuedTurn }, error: unknown): void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (t: unknown) => void;
}

const defaultRetryable = (e: unknown) => e instanceof CueApiError && e.retryable;

/**
 * Keeps turns in order while the server is unreachable and replays them with their original ids
 * (the server dedupes by turn id, so a replay that half-landed is safe). Ids are assigned on push.
 * A queued interim is replaced by a newer interim or the final with the same id.
 */
export class TurnBuffer {
  private queue: Item[] = [];
  private sending = false;
  private offline = false;
  private failures = 0;
  private timer: unknown = null;
  private disposed = false;
  private readonly o: Required<Pick<TurnBufferOptions, 'minRetryMs' | 'maxRetryMs' | 'maxSize'>> & TurnBufferOptions;

  constructor(opts: TurnBufferOptions) {
    this.o = { minRetryMs: 500, maxRetryMs: 8000, maxSize: 500, ...opts };
  }

  get pending(): number {
    return this.queue.length;
  }

  get isOffline(): boolean {
    return this.offline;
  }

  /** Queues a turn and starts sending. Returns the turn id (assigned here when missing). */
  push(callId: string, turn: TurnInput): string {
    const id = turn.id ?? newId('turn');
    const item: Item = { callId, turn: { ...turn, id } };
    // Never send a stale interim: a newer interim or the final for the same id replaces it.
    this.queue = this.queue.filter((q) => !(q.callId === callId && q.turn.id === id && q.turn.final === false));
    this.queue.push(item);
    while (this.queue.length > this.o.maxSize) {
      const i = this.queue.findIndex((q) => q.turn.final === false);
      this.queue.splice(i >= 0 ? i : 0, 1);
    }
    this.changed();
    void this.flush();
    return id;
  }

  /** Sends everything queued, in order. Stops at the first retryable failure and schedules a retry. */
  async flush(): Promise<void> {
    if (this.sending || this.disposed) return;
    this.sending = true;
    try {
      while (this.queue.length && !this.disposed) {
        const head = this.queue[0]!;
        try {
          await this.o.send(head.callId, head.turn);
          this.queue.shift();
          this.failures = 0;
          if (this.offline) {
            this.offline = false;
          }
          this.changed();
        } catch (e) {
          if ((this.o.isRetryable ?? defaultRetryable)(e)) {
            this.failures++;
            this.offline = true;
            this.changed();
            this.schedule();
            return;
          }
          this.queue.shift();
          this.o.onDrop?.(head, e);
          this.changed();
        }
      }
    } finally {
      this.sending = false;
    }
  }

  /** Forget everything queued for a call (e.g. it ended), or everything. */
  clear(callId?: string): void {
    this.queue = callId ? this.queue.filter((q) => q.callId !== callId) : [];
    this.changed();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) (this.o.clearTimeout ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.timer);
  }

  private schedule(): void {
    if (this.timer !== null || this.disposed) return;
    const delay = Math.min(this.o.maxRetryMs, this.o.minRetryMs * 2 ** Math.max(0, this.failures - 1));
    this.timer = (this.o.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private changed(): void {
    this.o.onChange?.({ pending: this.queue.length, offline: this.offline });
  }
}
