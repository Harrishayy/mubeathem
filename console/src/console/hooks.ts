"use client";

// How React reaches the engine. The engine mutates one state object every frame;
// panels re-render on the events they name (throttled), and draw per frame imperatively.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Store } from "@/engine/store";
import type { Actions } from "@/engine/actions";
import type { State } from "@/engine/types";

export interface Console {
  store: Store; actions: Actions;
  /** The running data source, and a way to switch to another (see src/sources). */
  sourceId: string; switchSource: (id: string) => void;
}
export const ConsoleCtx = createContext<Console | null>(null);

export function useConsole(): Console & { st: State } {
  const c = useContext(ConsoleCtx);
  if (!c) throw new Error("useConsole() must be used inside <ConsoleProvider>.");
  return { ...c, st: c.store.state };
}

/** Whether the running source offers every capability in `needs`. */
export function useCaps(needs: string[] = []) {
  const { st } = useConsole();
  return needs.every((n) => (st.source.caps as string[]).includes(n));
}

/** Run fn on an engine event. The latest fn is always used; no need to memoize it. */
export function useOn(evt: string, fn: (payload: any, state: State) => void) {
  const { store } = useConsole();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => store.on(evt, (p, s) => ref.current(p, s)), [store, evt]);
}

/** Run fn every animation frame with dt in seconds. */
export const useFrame = (fn: (dt: number) => void) => useOn("frame", fn);

/** Re-render when any of `events` fires, at most once every `ms`. Returns a counter. */
export function useTick(events: string[], ms = 0) {
  const { store } = useConsole();
  const [v, setV] = useState(0);
  const key = events.join("|");
  useEffect(() => {
    let last = 0, timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      const now = performance.now();
      if (now - last >= ms) { last = now; setV((x) => x + 1); }
      else if (!timer) timer = setTimeout(() => { timer = null; last = performance.now(); setV((x) => x + 1); }, ms - (now - last));
    };
    const offs = key.split("|").map((e) => store.on(e, bump));
    return () => { offs.forEach((f) => f()); if (timer) clearTimeout(timer); };
  }, [store, key, ms]);
  return v;
}

/** Element size, kept current with a ResizeObserver. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
