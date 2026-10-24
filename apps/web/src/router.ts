import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'live' }
  | { name: 'contacts' }
  | { name: 'history' }
  | { name: 'team' }
  | { name: 'playbook' }
  | { name: 'model' }
  | { name: 'insights' }
  | { name: 'settings' }
  | { name: 'debrief'; id: string }
  /** The fallback pop-out window (no Document PiP): just the overbar for one call. */
  | { name: 'pip'; id: string | null };

const SIMPLE = ['live', 'contacts', 'history', 'team', 'playbook', 'model', 'insights', 'settings'] as const;
export type SimpleRoute = (typeof SIMPLE)[number];

/** `#/debrief/call_1` → { name: 'debrief', id: 'call_1' }. Anything unknown is the live screen. */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const parts = path.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const [head, arg] = parts;
  if (head === 'debrief' && arg) return { name: 'debrief', id: arg };
  if (head === 'pip') return { name: 'pip', id: arg ?? null };
  if ((SIMPLE as readonly string[]).includes(head ?? '')) return { name: head as SimpleRoute };
  return { name: 'live' };
}

/** The `?a=1&b=2` part of the hash (filters that deep-link, e.g. `#/history?rep=rep_alex`). */
export function parseHashQuery(hash: string): URLSearchParams {
  const i = hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '');
}

export function hrefFor(r: Route, query?: Record<string, string | undefined | null>): string {
  if (r.name === 'debrief') return `#/debrief/${encodeURIComponent(r.id)}`;
  if (r.name === 'pip') return r.id ? `#/pip/${encodeURIComponent(r.id)}` : '#/pip';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const s = q.toString();
  return `#/${r.name}${s ? `?${s}` : ''}`;
}

export function navigate(r: Route, query?: Record<string, string | undefined | null>): void {
  const href = hrefFor(r, query);
  if (location.hash !== href) location.hash = href;
}

/** Swap the hash without a new history entry (filters as you type), and tell the router. */
export function replaceHash(href: string): void {
  if (location.hash === href) return;
  history.replaceState(history.state, '', href);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

function useHash(): string {
  return useSyncExternalStore(subscribe, () => location.hash, () => '');
}

export function useRoute(): Route {
  // parseHash is cheap; memo by string so consumers get a stable object per hash.
  return cachedParse(useHash());
}

/** The hash query as a plain object, stable per hash. */
export function useHashQuery(): Record<string, string> {
  return cachedQuery(useHash());
}

let last: { hash: string; route: Route } | null = null;
function cachedParse(hash: string): Route {
  if (last?.hash !== hash) last = { hash, route: parseHash(hash) };
  return last.route;
}
let lastQ: { hash: string; q: Record<string, string> } | null = null;
function cachedQuery(hash: string): Record<string, string> {
  if (lastQ?.hash !== hash) lastQ = { hash, q: Object.fromEntries(parseHashQuery(hash)) };
  return lastQ.q;
}
