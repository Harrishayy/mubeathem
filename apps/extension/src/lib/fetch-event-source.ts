import type { EventSourceLike } from '@cue/client';

type Listener = (ev: { data: string; lastEventId?: string }) => void;

/**
 * A minimal EventSource over `fetch`, for the MV3 service worker (which has no EventSource).
 * Implements just what `subscribeCall` needs: named events, onopen, onerror and close. It never
 * reconnects itself; `subscribeCall` owns backoff and the resume point.
 */
export class FetchEventSource implements EventSourceLike {
  onopen: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private ctrl = new AbortController();
  private closed = false;

  constructor(
    readonly url: string,
    private fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a),
  ) {
    void this.run();
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
  }

  close(): void {
    this.closed = true;
    this.ctrl.abort();
  }

  private fail(e: unknown) {
    if (this.closed) return;
    this.closed = true;
    this.ctrl.abort();
    this.onerror?.(e);
  }

  private async run(): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, { headers: { accept: 'text/event-stream' }, signal: this.ctrl.signal, cache: 'no-store' });
    } catch (e) {
      return this.fail(e);
    }
    if (!res.ok || !res.body) return this.fail(new Error(`stream answered ${res.status}`));
    if (this.closed) return;
    this.onopen?.({});
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        // Events end with a blank line; tolerate \r\n.
        let idx: number;
        while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
          this.dispatch(raw);
        }
      }
      this.fail(new Error('stream closed'));
    } catch (e) {
      this.fail(e);
    }
  }

  private dispatch(raw: string) {
    let event = 'message';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
      else if (field === 'id') id = value;
    }
    if (data.length === 0 || this.closed) return;
    const payload = { data: data.join('\n'), ...(id !== undefined ? { lastEventId: id } : {}) };
    for (const l of this.listeners.get(event) ?? []) l(payload);
  }
}
