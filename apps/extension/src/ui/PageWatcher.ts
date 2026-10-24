import type { Prospect } from '@cue/core';
import { readContact, sameProspect } from '../context/contact';
import { readTrellus, type TrellusReading } from '../context/trellus';

export interface PageReading {
  url: string;
  prospect: Prospect | null;
  trellus: TrellusReading;
}

/**
 * Re-reads the page when it changes (CRMs are SPAs: route changes and lazy panels), debounced, and
 * calls back only when what Cue cares about actually changed.
 */
export class PageWatcher {
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last: PageReading | null = null;
  private urlTimer: ReturnType<typeof setInterval> | null = null;
  private lastUrl = '';

  constructor(
    private doc: Document,
    private onChange: (r: PageReading) => void,
    private opts: { inTrellusFrame?: boolean; debounceMs?: number } = {},
  ) {}

  start(): void {
    this.read();
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(this.doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-call-state', 'data-state', 'data-status', 'class', 'value', 'href'] });
    // SPA navigations don't always mutate much; poll the URL cheaply.
    this.lastUrl = this.doc.location?.href ?? '';
    this.urlTimer = setInterval(() => {
      const u = this.doc.location?.href ?? '';
      if (u !== this.lastUrl) {
        this.lastUrl = u;
        this.schedule();
      }
    }, 1000);
  }

  stop(): void {
    this.observer?.disconnect();
    if (this.timer) clearTimeout(this.timer);
    if (this.urlTimer) clearInterval(this.urlTimer);
  }

  get current(): PageReading | null {
    return this.last;
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.read();
    }, this.opts.debounceMs ?? 400);
  }

  private read() {
    const url = this.doc.location?.href ?? '';
    const trellus = readTrellus(this.doc, { inTrellusFrame: this.opts.inTrellusFrame });
    const prospect = readContact(this.doc, url, trellus);
    const r: PageReading = { url, prospect, trellus };
    const prev = this.last;
    this.last = r;
    if (prev && prev.url === url && prev.trellus.state === trellus.state && prev.trellus.present === trellus.present && sameProspect(prev.prospect, prospect)) return;
    this.onChange(r);
  }
}
