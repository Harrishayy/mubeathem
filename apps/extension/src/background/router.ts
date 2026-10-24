import type { CueApi } from '@cue/client';
import type { BesideMode, HealthSummary, OffscreenEvent, UiRequest, UiResponse } from '../messages';
import type { Session } from './session';

export interface RouterDeps {
  session: Session;
  api(): CueApi;
  openPanel(tabId: number | null, windowId: number | null): Promise<void>;
  /** Opens a source beside the call tab (beside.ts). */
  beside?: { show(url: string, anchorTabId: number | null): Promise<BesideMode>; close(): Promise<void> };
}

export interface Sender {
  tabId: number | null;
  windowId: number | null;
  /** Content scripts in a sub-frame (a Trellus dialer iframe). */
  frameId: number;
}

const ok = <T>(data: T): UiResponse<T> => ({ ok: true, data });
const fail = (e: unknown): UiResponse<never> => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));

function isOffscreen(msg: unknown): msg is OffscreenEvent {
  const t = (msg as { type?: unknown })?.type;
  return t === 'capture.turn' || t === 'capture.levels' || t === 'capture.status' || t === 'offscreen.ready';
}

/**
 * Routes one runtime message. Returns `undefined` for messages that aren't ours (so another
 * listener, e.g. the offscreen document, can answer them), otherwise a UiResponse.
 */
export async function route(msg: unknown, sender: Sender, d: RouterDeps): Promise<UiResponse | undefined> {
  if (!msg || typeof msg !== 'object') return undefined;
  if ((msg as { target?: string }).target === 'offscreen') return undefined;

  if (isOffscreen(msg)) {
    switch (msg.type) {
      case 'capture.turn':
        d.session.addTurn(msg.turn);
        return ok(null);
      case 'capture.levels':
        d.session.levels(msg.levels);
        return ok(null);
      case 'capture.status':
        d.session.captureStatus(msg.side, msg.status);
        return ok(null);
      case 'offscreen.ready':
        return ok(null);
    }
  }

  const m = msg as UiRequest;
  try {
    switch (m.type) {
      case 'session.get':
        return ok(d.session.snapshot);
      case 'session.start':
        return ok(await d.session.start({ prospect: m.prospect, tabId: m.tabId ?? sender.tabId, source: m.source ?? 'cue', ...(m.contactId ? { contactId: m.contactId } : {}) }));
      case 'session.end':
        return ok(await d.session.end(m.outcome));
      case 'session.turn': {
        const id = d.session.typedTurn(m.speaker, m.text);
        return id ? ok({ id }) : fail(new Error('Start a call first'));
      }
      case 'session.action':
        await d.session.action(m.suggestionId, m.action, m.text);
        return ok(null);
      case 'session.feedback':
        return ok(await d.session.feedback(m.feedback));
      case 'session.reset':
        d.session.reset();
        return ok(d.session.snapshot);
      case 'capture.retry':
        await d.session.retryCapture();
        return ok(null);
      case 'capture.stop':
        await d.session.stopCapture();
        return ok(null);
      case 'capture.micSpeaker':
        await d.session.setMicSpeaker(m.speaker);
        return ok(null);
      case 'page.context':
        await d.session.pageContext({ ...m.context, tabId: sender.tabId ?? m.context.tabId });
        // Content scripts can't know their own tab id; tell them, so they can tell "my call" apart.
        return ok({ tabId: sender.tabId });
      case 'panel.open':
        await d.openPanel(sender.tabId, sender.windowId);
        return ok(null);
      case 'server.health': {
        const h = await d.api().health();
        return ok<HealthSummary>({ ok: h.ok, mubit: h.mubit.configured, trellus: h.trellus.configured });
      }
      case 'trellus.status':
        return ok(await d.api().trellusStatus());
      case 'contacts.search': {
        const q = m.q?.trim().slice(0, 120);
        return ok(await d.api().contacts({ ...(q ? { q } : {}), limit: clamp(m.limit ?? 20, 1, 100) }));
      }
      case 'contacts.history':
        return ok(await d.api().listCalls({ contactId: m.contactId, limit: clamp(m.limit ?? 3, 1, 20) }));
      case 'research.warm':
        return ok(await d.api().warmResearch('contactId' in m ? { contactId: m.contactId } : { prospect: m.prospect }));
      case 'research.brief':
        return ok(await d.api().researchBrief('contactId' in m ? { contactId: m.contactId } : { prospect: m.prospect }));
      case 'calls.search': {
        const q = m.q?.trim().slice(0, 120);
        return ok(await d.api().listCalls({ ...(q ? { q } : {}), ...(m.contactId ? { contactId: m.contactId } : {}), limit: clamp(m.limit ?? 50, 1, 200) }));
      }
      case 'beside.open': {
        if (!d.beside) return fail(new Error('Opening beside the call is not available here'));
        // The call's tab when there is a call; else the tab the request came from (the overlay), else the active tab.
        const snap = d.session.snapshot;
        const anchor = snap.phase !== 'idle' ? (snap.tabId ?? sender.tabId) : (sender.tabId ?? snap.page?.tabId ?? null);
        return ok({ mode: await d.beside.show(m.url, anchor) });
      }
      case 'beside.close':
        await d.beside?.close();
        return ok(null);
      default:
        return undefined;
    }
  } catch (e) {
    return fail(e);
  }
}
