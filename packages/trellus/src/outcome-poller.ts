import type { OutcomeRecord, Prospect } from '@cue/core';
import type { CallSource } from './source';

export interface OpenCall {
  callId: string;
  startedAt: number;
  endedAt?: number;
  prospect: Prospect;
}

export interface OutcomePollerOptions {
  source: CallSource;
  /** 0 disables polling (start() is a no-op). */
  intervalMs: number;
  /** Ended calls still waiting for an outcome. */
  getOpenCalls: () => Promise<OpenCall[]> | OpenCall[];
  onOutcome: (callId: string, outcome: OutcomeRecord) => Promise<void> | void;
  /** Called once when a call is abandoned. */
  onGiveUp?: (callId: string) => void;
  onError?: (err: unknown, callId?: string) => void;
  now?: () => number;
  /** Default 2 h from the end of the call (or its start, if it never ended). */
  giveUpAfterMs?: number;
}

export interface OutcomePoller {
  start(): void;
  stop(): void;
  /** One pass over the open calls. Never throws. */
  tick(): Promise<void>;
  readonly running: boolean;
}

export const GIVE_UP_AFTER_MS = 2 * 60 * 60 * 1000;

export function createOutcomePoller(opts: OutcomePollerOptions): OutcomePoller {
  const now = opts.now ?? Date.now;
  const giveUpAfter = opts.giveUpAfterMs ?? GIVE_UP_AFTER_MS;
  const done = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let inFlight: Promise<void> | null = null;

  const report = (err: unknown, callId?: string) => {
    try {
      opts.onError?.(err, callId);
    } catch {
      /* a broken error handler must not stop polling */
    }
  };

  async function pass(): Promise<void> {
    let calls: OpenCall[];
    try {
      calls = await opts.getOpenCalls();
    } catch (err) {
      report(err);
      return;
    }
    // One at a time: the client's per-endpoint budget is per user and shared.
    for (const call of calls) {
      if (done.has(call.callId)) continue;
      if (now() - (call.endedAt ?? call.startedAt) > giveUpAfter) {
        done.add(call.callId);
        opts.onGiveUp?.(call.callId);
        continue;
      }
      try {
        const outcome = await opts.source.findOutcome({ startedAt: call.startedAt, ...(call.endedAt !== undefined ? { endedAt: call.endedAt } : {}), prospect: call.prospect });
        if (outcome) {
          done.add(call.callId);
          await opts.onOutcome(call.callId, outcome);
        }
      } catch (err) {
        report(err, call.callId);
      }
    }
  }

  function tick(): Promise<void> {
    inFlight ??= pass().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function schedule() {
    if (!running) return;
    timer = setTimeout(() => {
      void tick().then(schedule);
    }, opts.intervalMs);
  }

  return {
    start() {
      if (running || opts.intervalMs <= 0) return;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    tick,
    get running() {
      return running;
    },
  };
}
