import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'live' }
  | { name: 'practice' }
  | { name: 'playbook' }
  | { name: 'model' }
  | { name: 'history' }
  | { name: 'settings' }
  | { name: 'debrief'; id: string }
  /** The fallback pop-out window (no Document PiP): just the overbar for one call. */
  | { name: 'pip'; id: string | null };

const SIMPLE = ['live', 'practice', 'playbook', 'model', 'history', 'settings'] as const;

/** `#/debrief/call_1` → { name: 'debrief', id: 'call_1' }. Anything unknown is the live screen. */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split(/[/?]/).filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const [head, arg] = parts;
  if (head === 'debrief' && arg) return { name: 'debrief', id: arg };
  if (head === 'pip') return { name: 'pip', id: arg ?? null };
  if ((SIMPLE as readonly string[]).includes(head ?? '')) return { name: head as (typeof SIMPLE)[number] };
  return { name: 'live' };
}

export function hrefFor(r: Route): string {
  if (r.name === 'debrief') return `#/debrief/${encodeURIComponent(r.id)}`;
  if (r.name === 'pip') return r.id ? `#/pip/${encodeURIComponent(r.id)}` : '#/pip';
  return `#/${r.name}`;
}

export function navigate(r: Route): void {
  const href = hrefFor(r);
  if (location.hash !== href) location.hash = href;
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash, () => '');
  // parseHash is cheap; memo by string so consumers get a stable object per hash.
  return cachedParse(hash);
}

let last: { hash: string; route: Route } | null = null;
function cachedParse(hash: string): Route {
  if (last?.hash !== hash) last = { hash, route: parseHash(hash) };
  return last.route;
}
