import { createCueApi, subscribeCall, type CueApi } from '@cue/client';
import type { CallView, ContactListResponse, ResearchBriefResponse } from '@cue/core';
import { defineBackground } from 'wxt/utils/define-background';
import { Beside, chromeBesideDeps, splitSupported } from '../src/background/beside';
import { setMicSpeaker, startCapture, stopCapture } from '../src/background/capture';
import { route, type Sender } from '../src/background/router';
import { Session } from '../src/background/session';
import { sttCredentials } from '../src/background/stt';
import { badgeFor, outcomeNote, xml } from '../src/background/surfaces';
import { FetchEventSource } from '../src/lib/fetch-event-source';
import { webAppMatches } from '../src/manifest';
import { UI_PORT, type Broadcast, type SessionState, type UiRequest } from '../src/messages';
import { loadSettings, updateSettings, watchSettings, webAppRoute, type Settings } from '../src/settings';

const BRIDGE_ID = 'cue-webapp';
const MENU_BESIDE = 'cue-open-beside';
const MENU_FIND = 'cue-find';

/**
 * The service worker owns the call: one Session, every surface (side panel, overlays) connected over
 * a port and kept in sync by broadcast. Around it, the rest of Chrome: the toolbar badge, the outcome
 * notification, "open beside the call" (split view), the right-click menu, the "cue" omnibox keyword
 * and the bridge that lets the web app's Settings drive the extension. Listeners are registered
 * synchronously at start-up so Chrome can wake the worker for them.
 */
export default defineBackground(() => {
  const ports = new Set<chrome.runtime.Port>();
  let settings: Settings | null = null;
  let api: CueApi | null = null;
  const beside = new Beside(chromeBesideDeps(), splitSupported);

  const makeApi = (s: Settings) => {
    api = createCueApi({ baseUrl: s.serverUrl, token: s.token || undefined });
    return api;
  };
  const getApi = () => api ?? makeApi(settings!);

  /* ───────── badge and notifications ───────── */

  let briefHooks = 0;
  let lastView: CallView | null = null;
  const told = new Set<string>();
  let ticker: ReturnType<typeof setInterval> | null = null;

  const paintBadge = (state: SessionState) => {
    const b = badgeFor(state, Date.now(), briefHooks);
    void chrome.action.setBadgeText({ text: b.text }).catch(() => {});
    void chrome.action.setBadgeBackgroundColor({ color: b.color }).catch(() => {});
    void chrome.action.setTitle({ title: b.title }).catch(() => {});
  };

  const onState = (state: SessionState) => {
    const live = state.phase === 'live' || state.phase === 'starting';
    if (live && !ticker) ticker = setInterval(() => paintBadge(session.snapshot), 1000);
    if (!live && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    if (state.phase === 'idle' && !state.page?.prospect) briefHooks = 0;
    paintBadge(state);
    const note = outcomeNote(lastView, state.view, told);
    lastView = state.view;
    if (note) {
      void chrome.notifications
        .create(note.id, { type: 'basic', iconUrl: chrome.runtime.getURL('icon/128.png'), title: note.title, message: note.message, buttons: [{ title: 'Looks right' }, { title: 'Open Cue' }], priority: 1 })
        .catch(() => {});
    }
  };

  const broadcast = (b: Broadcast) => {
    if (b.type === 'state') onState(b.state);
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
        { stt: () => sttCredentials(getApi()), micSpeaker: session.snapshot.micSpeaker },
        (side, status) => session.captureStatus(side, status),
      ),
    stopCapture,
    setMicSpeaker,
    broadcast,
    store: chrome.storage.session,
  });

  /* ───────── the web app's bridge ───────── */

  const registerBridge = async (s: Settings) => {
    const wanted = webAppMatches(s.serverUrl, s.webUrl);
    const matches: string[] = [];
    for (const m of wanted) if (await chrome.permissions.contains({ origins: [m] }).catch(() => false)) matches.push(m);
    await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_ID] }).catch(() => {});
    if (!matches.length) return;
    await chrome.scripting
      .registerContentScripts([{ id: BRIDGE_ID, matches, js: ['content-scripts/webapp.js'], runAt: 'document_start', persistAcrossSessions: true }])
      .catch((e) => console.warn('[cue] bridge not registered', e));
  };

  const ready = session
    .init()
    .then(() => registerBridge(settings!))
    .catch((e) => console.error('[cue] init failed', e));
  watchSettings((s) => {
    const moved = !settings || s.serverUrl !== settings.serverUrl || s.webUrl !== settings.webUrl;
    settings = s;
    void session.applySettings(s);
    if (moved) void registerBridge(s);
  });

  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  const openPanel = async (tabId: number | null, windowId: number | null) => {
    if (tabId !== null) await chrome.sidePanel.open({ tabId });
    else if (windowId !== null) await chrome.sidePanel.open({ windowId });
  };

  /* ───────── messages from the panel and the overlays ───────── */

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
      .then(() => route(msg, from, { session, api: getApi, openPanel, beside }))
      .then((res) => {
        // The brief's hook count goes on the badge before the call ("3 reasons to call now").
        if (res?.ok && (msg as UiRequest).type === 'research.brief') {
          briefHooks = (res.data as ResearchBriefResponse).brief.hooks.length;
          paintBadge(session.snapshot);
        }
        sendResponse(res);
      });
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

  chrome.tabs.onRemoved.addListener((tabId) => {
    beside.forget(tabId);
    void ready.then(() => session.pageGone(tabId));
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

  /* ───────── notification: the outcome Trellus logged ───────── */

  const callIdOf = (notificationId: string) => notificationId.replace(/^cue-outcome-/, '');

  chrome.notifications.onButtonClicked.addListener((id, button) => {
    if (!id.startsWith('cue-outcome-')) return;
    const callId = callIdOf(id);
    void chrome.notifications.clear(id);
    if (button === 0) {
      void ready.then(async () => {
        const view = session.snapshot.view?.id === callId ? session.snapshot.view : await getApi().getCall(callId).catch(() => null);
        const outcome = view?.outcome?.outcome;
        if (outcome) await getApi().feedback(callId, { outcome, helpful: [], unhelpful: [] }).catch(() => {});
      });
    } else {
      const tabId = session.snapshot.tabId;
      void (tabId !== null ? chrome.sidePanel.open({ tabId }) : Promise.reject()).catch(() => chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') }));
    }
  });

  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith('cue-outcome-')) return;
    void chrome.notifications.clear(id);
    const tabId = session.snapshot.tabId;
    void (tabId !== null ? chrome.sidePanel.open({ tabId }) : Promise.reject()).catch(() => chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') }));
  });

  /* ───────── right-click ───────── */

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void ready.then(async () => {
      if (info.menuItemId === MENU_BESIDE && info.linkUrl) {
        const snap = session.snapshot;
        await beside.show(info.linkUrl, snap.phase !== 'idle' ? snap.tabId : (tab?.id ?? null)).catch(() => {});
      } else if (info.menuItemId === MENU_FIND && info.selectionText && settings) {
        await chrome.tabs.create({ url: webAppRoute(settings, 'history', { q: info.selectionText.trim().slice(0, 120) }), ...(tab?.index !== undefined ? { index: tab.index + 1 } : {}) });
      }
    });
  });

  /* ───────── the "cue" keyword in the address bar ───────── */

  let omniTimer: ReturnType<typeof setTimeout> | null = null;
  chrome.omnibox.setDefaultSuggestion({ description: 'Search Cue for <match>%s</match>: contacts and past calls' });
  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    if (omniTimer) clearTimeout(omniTimer);
    const q = text.trim().slice(0, 120);
    if (q.length < 2) return;
    omniTimer = setTimeout(() => {
      void ready
        .then(() => getApi().contacts({ q, limit: 6 }))
        .then((res: ContactListResponse) =>
          suggest(
            res.items.map((c) => ({
              content: `contact:${c.id}`,
              description: `<match>${xml(c.name || c.company || c.phone || 'Contact')}</match> <dim>${xml([c.title, c.company].filter(Boolean).join(' · '))}</dim>`,
            })),
          ),
        )
        .catch(() => {});
    }, 180);
  });
  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    void ready.then(() => {
      if (!settings) return;
      const contact = text.startsWith('contact:') ? text.slice('contact:'.length) : null;
      const url = contact ? webAppRoute(settings, 'history', { contact }) : webAppRoute(settings, 'history', { q: text.trim().slice(0, 120) });
      if (disposition === 'currentTab') void chrome.tabs.update({ url });
      else void chrome.tabs.create({ url, active: disposition === 'newForegroundTab' });
    });
  });

  /* ───────── install and update ───────── */

  chrome.runtime.onInstalled.addListener(async () => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: MENU_BESIDE, title: 'Open beside the call', contexts: ['link'] });
      chrome.contextMenus.create({ id: MENU_FIND, title: 'Find “%s” in Cue', contexts: ['selection'] });
    });
    // Overlays in tabs that were open before install don't exist yet; inject into them once.
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
