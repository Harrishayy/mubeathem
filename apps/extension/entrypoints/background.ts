import { createCueApi, subscribeCall, type CueApi } from '@cue/client';
import { defineBackground } from 'wxt/utils/define-background';
import { setMicSpeaker, startCapture, stopCapture } from '../src/background/capture';
import { route, type Sender } from '../src/background/router';
import { Session } from '../src/background/session';
import { sttCredentials } from '../src/background/stt';
import { FetchEventSource } from '../src/lib/fetch-event-source';
import { UI_PORT, type Broadcast } from '../src/messages';
import { loadSettings, updateSettings, watchSettings, type Settings } from '../src/settings';

/**
 * The service worker owns the call: one Session, every surface (side panel, overlays) connected over
 * a port and kept in sync by broadcast. It must register its listeners synchronously at start-up so
 * Chrome can wake it for them.
 */
export default defineBackground(() => {
  const ports = new Set<chrome.runtime.Port>();
  let settings: Settings | null = null;
  let api: CueApi | null = null;

  const makeApi = (s: Settings) => {
    api = createCueApi({ baseUrl: s.serverUrl, token: s.token || undefined });
    return api;
  };

  const broadcast = (b: Broadcast) => {
    for (const p of ports) {
      try {
        p.postMessage(b);
      } catch {
        ports.delete(p);
      }
    }
  };

  const session = new Session({
    loadSettings: async () => (settings = await loadSettings()),
    makeApi,
    subscribe: (a, callId, handlers) => subscribeCall(a, callId, handlers, { EventSource: FetchEventSource }),
    startCapture: (tabId, startedAt) =>
      startCapture(
        tabId,
        startedAt,
        { stt: () => sttCredentials(api ?? makeApi(settings!)), micSpeaker: session.snapshot.micSpeaker },
        (side, status) => session.captureStatus(side, status),
      ),
    stopCapture,
    setMicSpeaker,
    broadcast,
    store: chrome.storage.session,
  });

  const ready = session.init().catch((e) => console.error('[cue] init failed', e));
  watchSettings((s) => {
    settings = s;
    void session.applySettings(s);
  });

  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  const openPanel = async (tabId: number | null, windowId: number | null) => {
    if (tabId !== null) await chrome.sidePanel.open({ tabId });
    else if (windowId !== null) await chrome.sidePanel.open({ windowId });
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const from: Sender = { tabId: sender.tab?.id ?? null, windowId: sender.tab?.windowId ?? null, frameId: sender.frameId ?? 0 };
    // sidePanel.open must run inside the user gesture, before any await.
    if ((msg as { type?: string })?.type === 'panel.open') {
      openPanel(from.tabId, from.windowId)
        // Chrome only opens the panel inside a user gesture; if the click's gesture didn't carry
        // over the message hop, open the same screens in a tab rather than doing nothing.
        .catch(() => chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html'), ...(from.windowId !== null ? { windowId: from.windowId } : {}) }))
        .then(
          () => sendResponse({ ok: true, data: null }),
          (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      return true;
    }
    if ((msg as { target?: string })?.target === 'offscreen') return false;
    void ready
      .then(() => route(msg, from, { session, api: () => api ?? makeApi(settings!), openPanel }))
      .then((res) => sendResponse(res));
    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== UI_PORT) return;
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    // Pings from the UI keep the worker awake during a call; nothing to answer.
    port.onMessage.addListener(() => {});
    void ready.then(() => port.postMessage({ type: 'state', state: session.snapshot } satisfies Broadcast));
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    void ready.then(async () => {
      if (command === 'toggle-overbar') {
        const s = await updateSettings({ overlay: !(settings?.overlay ?? true) });
        broadcast({ type: 'overlay.toggle', visible: s.overlay });
        // The shortcut is also the user gesture tab capture needs: if a call is waiting on it, retry.
        const snap = session.snapshot;
        if (tab?.id !== undefined && snap.tabId === tab.id && snap.capture.tab.state === 'denied') void session.retryCapture();
      } else if (command === 'mark-booked') {
        if (session.snapshot.phase === 'live') await session.end('meeting_booked');
      }
    });
  });

  // Overlays in tabs that were open before install don't exist yet; inject into them once.
  chrome.runtime.onInstalled.addListener(async () => {
    const manifest = chrome.runtime.getManifest();
    for (const cs of manifest.content_scripts ?? []) {
      const tabs = await chrome.tabs.query({ url: cs.matches ?? [] }).catch(() => []);
      for (const t of tabs) {
        if (t.id === undefined || t.discarded) continue;
        await chrome.scripting
          .executeScript({ target: { tabId: t.id, allFrames: !!cs.all_frames }, files: cs.js ?? [] })
          .catch(() => {});
      }
    }
  });
});
