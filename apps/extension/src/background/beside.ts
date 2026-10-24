/**
 * "Open beside": a source from the brief (or any link) opens next to the call tab, so the rep reads it
 * without losing HubSpot and the dialer. Chrome 155+ puts it in a Split View with the call tab
 * (`tabs.create({ splitWithTabId })`, no permission needed); older Chrome gets a second window on the
 * right half of the screen; a call tab Chrome won't split (pinned, in another split) gets the next tab.
 * One research tab per call: the next source reuses it rather than piling tabs up.
 */
export type BesideMode = 'split' | 'window' | 'tab';

type Tab = Pick<chrome.tabs.Tab, 'id' | 'windowId' | 'index' | 'splitViewId'>;
type Win = Pick<chrome.windows.Window, 'id' | 'left' | 'top' | 'width' | 'height' | 'state'>;

/** The slice of chrome.tabs / chrome.windows used here; injectable so the logic is tested without Chrome. */
export interface BesideDeps {
  getTab(id: number): Promise<Tab>;
  activeTab(): Promise<Tab | null>;
  createTab(props: { url: string; active?: boolean; index?: number; windowId?: number; splitWithTabId?: number }): Promise<Tab>;
  updateTab(id: number, props: { url: string; active: boolean }): Promise<Tab>;
  removeTab(id: number): Promise<void>;
  /** Present on Chrome 155+. */
  unsplit?: (splitViewId: number) => Promise<void>;
  getWindow(id: number): Promise<Win>;
  createWindow(props: { url: string; left?: number; top?: number; width?: number; height?: number; focused: boolean }): Promise<{ tabs?: Tab[] }>;
  updateWindow(id: number, props: { state?: 'normal' | 'maximized'; left?: number; top?: number; width?: number; height?: number; focused?: boolean }): Promise<unknown>;
  focusWindow(id: number): Promise<void>;
}

export function chromeBesideDeps(): BesideDeps {
  const tabs = chrome.tabs as typeof chrome.tabs & { unsplit?: (id: number) => Promise<void>; createSplit?: unknown };
  const split = typeof tabs.createSplit === 'function';
  return {
    getTab: (id) => chrome.tabs.get(id),
    activeTab: async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] ?? null,
    // splitWithTabId is only passed where Chrome knows it; older versions reject unknown properties.
    createTab: ({ splitWithTabId, ...p }) => chrome.tabs.create(split && splitWithTabId !== undefined ? { ...p, splitWithTabId } : p),
    updateTab: (id, p) => chrome.tabs.update(id, p) as Promise<Tab>,
    removeTab: (id) => chrome.tabs.remove(id),
    ...(split && typeof tabs.unsplit === 'function' ? { unsplit: (id: number) => tabs.unsplit!(id) } : {}),
    getWindow: (id) => chrome.windows.get(id),
    createWindow: (p) => chrome.windows.create({ ...p, type: 'normal' }) as Promise<{ tabs?: Tab[] }>,
    updateWindow: (id, p) => chrome.windows.update(id, p),
    focusWindow: async (id) => void (await chrome.windows.update(id, { focused: true })),
  };
}

export function splitSupported(): boolean {
  return typeof (chrome.tabs as { createSplit?: unknown }).createSplit === 'function';
}

/** Only web pages open beside the call. */
export function besideUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export class Beside {
  private open: { tabId: number; mode: BesideMode } | null = null;

  constructor(
    private deps: BesideDeps,
    private canSplit: () => boolean,
  ) {}

  get current(): { tabId: number; mode: BesideMode } | null {
    return this.open;
  }

  /** Opens `url` beside `anchorTabId` (the call tab; else the active tab). */
  async show(url: string, anchorTabId: number | null): Promise<BesideMode> {
    const target = besideUrl(url);
    if (!target) throw new Error('Only web pages can open beside the call');

    // The research tab is already open: show this source in it.
    if (this.open) {
      try {
        const t = await this.deps.updateTab(this.open.tabId, { url: target, active: true });
        if (this.open.mode === 'window' && t.windowId !== undefined) await this.deps.focusWindow(t.windowId);
        return this.open.mode;
      } catch {
        this.open = null; // the rep closed it
      }
    }

    const anchor = await this.anchor(anchorTabId);
    if (anchor?.id !== undefined && this.canSplit()) {
      try {
        const t = await this.deps.createTab({ url: target, active: true, windowId: anchor.windowId, index: anchor.index + 1, splitWithTabId: anchor.id });
        return this.remember(t, 'split');
      } catch {
        /* Chrome wouldn't split this tab: fall through to a window */
      }
    }

    if (anchor?.windowId !== undefined) {
      try {
        const w = await this.deps.getWindow(anchor.windowId);
        if (w.id !== undefined && w.width && w.height && w.state !== 'minimized') {
          const left = w.left ?? 0;
          const top = w.top ?? 0;
          const half = Math.floor(w.width / 2);
          const restore = { state: w.state === 'maximized' || w.state === 'fullscreen' ? undefined : ('normal' as const), left, top, width: w.width, height: w.height };
          await this.deps.updateWindow(w.id, { state: 'normal', left, top, width: half, height: w.height });
          try {
            const created = await this.deps.createWindow({ url: target, left: left + half, top, width: w.width - half, height: w.height, focused: true });
            const t = created.tabs?.[0];
            if (t) return this.remember(t, 'window');
          } catch (e) {
            // Chrome refused the window (off screen, say): put the call window back as it was.
            await this.deps.updateWindow(w.id, w.state === 'maximized' ? { state: 'maximized' } : restore).catch(() => {});
            throw e;
          }
        }
      } catch {
        /* no window to share: a tab will do */
      }
    }

    const t = await this.deps.createTab({ url: target, active: true, ...(anchor ? { windowId: anchor.windowId, index: anchor.index + 1 } : {}) });
    return this.remember(t, 'tab');
  }

  /** Closes the research tab (and its split), leaving the call tab as it was. */
  async close(): Promise<void> {
    const open = this.open;
    this.open = null;
    if (!open) return;
    try {
      const t = await this.deps.getTab(open.tabId);
      if (open.mode === 'split' && t.splitViewId !== undefined && t.splitViewId >= 0) await this.deps.unsplit?.(t.splitViewId);
      await this.deps.removeTab(open.tabId);
    } catch {
      /* already gone */
    }
  }

  /** A tab closed somewhere: forget it if it was ours. */
  forget(tabId: number): void {
    if (this.open?.tabId === tabId) this.open = null;
  }

  private async anchor(tabId: number | null): Promise<Tab | null> {
    if (tabId !== null) {
      try {
        return await this.deps.getTab(tabId);
      } catch {
        /* the call tab is gone */
      }
    }
    return this.deps.activeTab().catch(() => null);
  }

  private remember(t: Tab, mode: BesideMode): BesideMode {
    if (t.id !== undefined) this.open = { tabId: t.id, mode };
    return mode;
  }
}
