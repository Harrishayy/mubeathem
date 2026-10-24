/**
 * Per-endpoint request budget: at most `capacity` requests in any rolling `windowMs`, and at least
 * `minGapMs` between two requests. Callers queue in order; nothing is dropped.
 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface BucketSpec {
  capacity: number;
  windowMs: number;
  minGapMs?: number;
}

export interface TokenBucket {
  /** Resolves when a request may be sent, and records it. */
  take(): Promise<void>;
  /** After a 429: send nothing before `untilMs`. */
  blockUntil(untilMs: number): void;
  /** How long a request made now would wait, ms. */
  waitMs(): number;
}

export function createTokenBucket(spec: BucketSpec, clock: Clock = realClock): TokenBucket {
  const sent: number[] = [];
  let blockedUntil = 0;
  let queue: Promise<void> = Promise.resolve();

  const waitMs = (): number => {
    const now = clock.now();
    while (sent.length && sent[0]! <= now - spec.windowMs) sent.shift();
    let wait = Math.max(0, blockedUntil - now);
    if (sent.length >= spec.capacity) wait = Math.max(wait, sent[sent.length - spec.capacity]! + spec.windowMs - now);
    const last = sent[sent.length - 1];
    if (spec.minGapMs && last !== undefined) wait = Math.max(wait, last + spec.minGapMs - now);
    return wait;
  };

  const takeNow = async (): Promise<void> => {
    for (let w = waitMs(); w > 0; w = waitMs()) await clock.sleep(w);
    sent.push(clock.now());
  };

  return {
    take() {
      const next = queue.then(takeNow);
      queue = next.catch(() => undefined);
      return next;
    },
    blockUntil(untilMs) {
      blockedUntil = Math.max(blockedUntil, untilMs);
    },
    waitMs,
  };
}

/**
 * Default per-user limits from the docs. Session list is 2 per 4 s shared by v5 and v6, and the docs
 * ask for at least 2.5 s between calls. Audio links have no documented limit; 1/s is our guess.
 */
export const TRELLUS_LIMITS = {
  visible: { capacity: 2, windowMs: 4000 },
  bootstrap: { capacity: 2, windowMs: 4000 },
  sessionList: { capacity: 2, windowMs: 4000, minGapMs: 2500 },
  metricDetails: { capacity: 4, windowMs: 4000 },
  session: { capacity: 1, windowMs: 1000 },
  audioLinks: { capacity: 1, windowMs: 1000 },
} as const satisfies Record<string, BucketSpec>;
