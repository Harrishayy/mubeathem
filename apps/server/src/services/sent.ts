/**
 * Counts Mubit requests that actually left the process, per (session, task), by watching the
 * `fetch` handed to the Mubit client. The client counts an attempt before it gets a concurrency
 * slot, so only the wire tells us whether a cancelled run was really sent (and may still land in
 * Mubit as a training example).
 */
export interface SentCounter {
  count(sessionId: string, task: string): number;
}

export class SentTracker implements SentCounter {
  private counts = new Map<string, number>();

  count(sessionId: string, task: string): number {
    return this.counts.get(`${sessionId}\u0000${task}`) ?? 0;
  }

  mark(sessionId: string, task: string): void {
    const k = `${sessionId}\u0000${task}`;
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
    if (this.counts.size > 5000) this.counts.delete(this.counts.keys().next().value as string);
  }

  /** Wraps fetch: a Responses API body names the session (`prompt_cache_key`) and task (`text.format.name`). */
  wrap(f: typeof fetch): typeof fetch {
    return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (typeof init?.body === 'string') {
        try {
          const b = JSON.parse(init.body) as { prompt_cache_key?: unknown; text?: { format?: { name?: unknown } } };
          if (typeof b.prompt_cache_key === 'string' && typeof b.text?.format?.name === 'string') this.mark(b.prompt_cache_key, b.text.format.name);
        } catch {
          /* not a Responses call */
        }
      }
      return f(input, init);
    }) as typeof fetch;
  }
}
