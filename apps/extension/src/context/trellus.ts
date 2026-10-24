import { clean, textOf } from './dom';

/**
 * Trellus's dialer, read from the page. Trellus has no realtime API, so the page is the only live
 * signal for "a call just connected". The dialer is either injected into the CRM page (an element
 * or an iframe from trellus.ai) or is the app.trellus.ai page itself, where this reader runs inside
 * the frame (the content script is registered for all frames on trellus.ai).
 */
export type TrellusCallState = 'none' | 'idle' | 'dialing' | 'connected' | 'ended';

export interface TrellusReading {
  present: boolean;
  state: TrellusCallState;
  /** The number or name the dialer shows, when it does. */
  dialling?: { name?: string; phone?: string };
}

export const TRELLUS_ROOTS = [
  '[data-trellus-dialer]',
  '#trellus-dialer',
  '#trellus-root',
  '[id^="trellus" i]',
  '[class*="trellus" i]',
  'iframe[src*="trellus.ai"]',
] as const;

const STATE_ATTRS = ['data-call-state', 'data-state', 'data-status'];

const CONNECTED = /\b(connected|in progress|on call|live call|talking)\b/i;
const DIALING = /\b(ringing|dialing|dialling|calling|connecting)\b/i;
const ENDED = /\b(call ended|ended|disconnected|hung up|call complete|wrap[- ]?up|no answer|voicemail left)\b/i;
const HANGUP = /\b(hang ?up|end call|end the call|disconnect)\b/i;
const TIMER = /\b\d{1,2}:\d{2}\b/;
const PHONE = /(\+?\d[\d\s().-]{6,}\d)/;

/** Maps a raw state word from a data attribute. */
export function stateFromWord(w: string): TrellusCallState | null {
  const s = w.toLowerCase();
  if (/connecting|ring|dial|calling/.test(s)) return 'dialing';
  if (/end|disconnect|hang|complete|wrap|finish/.test(s)) return 'ended';
  if (/connect|in[-_ ]?progress|active|live|talking|on[-_ ]?call/.test(s)) return 'connected';
  if (/idle|ready|waiting/.test(s)) return 'idle';
  return null;
}

/** The dialer panel on the page, if there is one. Returns the document element inside a Trellus frame. */
export function findTrellusRoot(doc: Document, inTrellusFrame = false): Element | null {
  if (inTrellusFrame) return doc.body;
  for (const sel of TRELLUS_ROOTS) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(sel);
    } catch {
      continue;
    }
    // Our own overlay host must never count as Trellus.
    if (el && !el.closest('cue-overlay')) return el;
  }
  return null;
}

/** Reads the call state from the dialer panel. Pure; fixtures in test/fixtures. */
export function readTrellus(doc: Document, opts: { inTrellusFrame?: boolean } = {}): TrellusReading {
  const root = findTrellusRoot(doc, opts.inTrellusFrame);
  if (!root) return { present: false, state: 'none' };
  // A cross-origin dialer iframe can't be read from here; the frame reports itself.
  if (root.tagName === 'IFRAME') return { present: true, state: 'idle' };

  for (const attr of STATE_ATTRS) {
    const holder = root.matches(`[${attr}]`) ? root : root.querySelector(`[${attr}]`);
    const w = holder?.getAttribute(attr);
    const s = w ? stateFromWord(w) : null;
    if (s) return { present: true, state: s, dialling: readDialling(root) };
  }

  const text = clean(textOf(root), 4000);
  const buttons = [...root.querySelectorAll('button, [role="button"]')].map((b) => clean(b.getAttribute('aria-label') || b.textContent || ''));
  const canHangUp = buttons.some((b) => HANGUP.test(b));
  let state: TrellusCallState = 'idle';
  if (canHangUp && DIALING.test(text) && !CONNECTED.test(text)) state = 'dialing';
  else if (canHangUp || (CONNECTED.test(text) && TIMER.test(text))) state = 'connected';
  else if (ENDED.test(text)) state = 'ended';
  else if (DIALING.test(text)) state = 'dialing';
  else if (CONNECTED.test(text)) state = 'connected';
  return { present: true, state, dialling: readDialling(root) };
}

function readDialling(root: Element): TrellusReading['dialling'] {
  const name = clean(
    root.querySelector('[data-contact-name], [data-testid*="contact-name" i], [class*="contact-name" i], [class*="contactName"]')?.textContent ?? '',
    200,
  );
  const tel = root.querySelector<HTMLAnchorElement>('a[href^="tel:"]');
  let phone = tel ? clean(decodeURIComponent(tel.getAttribute('href')!.slice(4)), 40) : '';
  if (!phone) {
    const el = root.querySelector('[data-phone], [class*="phone" i]');
    const m = clean(el?.textContent ?? '').match(PHONE);
    phone = m ? clean(m[1], 40) : '';
  }
  if (!name && !phone) return undefined;
  return { ...(name ? { name } : {}), ...(phone ? { phone } : {}) };
}

/** True when the state change should offer (or auto-start) Cue. */
export function justConnected(prev: TrellusCallState, next: TrellusCallState): boolean {
  return next === 'connected' && prev !== 'connected';
}

export function justEnded(prev: TrellusCallState, next: TrellusCallState): boolean {
  return next === 'ended' && (prev === 'connected' || prev === 'dialing');
}
