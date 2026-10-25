"use client";

// Creates the engine on Steward's runs and drives the frame loop. It sits in the root
// layout, so the fleet keeps following the runs dir while you switch tabs.
//
// The Safety lab reads its own reports (services/safety), so it never waits on the runs:
// opened there, the console renders at once on an empty store and starts the runs source
// (and its polling) only when another tab is opened.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createStore } from "@/engine/store";
import { initialState } from "@/engine/state";
import { createActions } from "@/engine/actions";
import { tickPlayback } from "@/engine/playback";
import { readColors, watchTheme } from "@/engine/theme";
import { SOURCE } from "@/sources";
import { ConsoleCtx, type Console } from "./hooks";

/** Tabs that render without the runs source. */
const STANDALONE = new Set(["safety"]);

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const standalone = STANDALONE.has(usePathname().split("/")[1] || "");
  const [c, setC] = useState<Console | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [wanted, setWanted] = useState(!standalone);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => { readColors(); }, []);
  useEffect(() => { if (!standalone) setWanted(true); }, [standalone]);

  useEffect(() => {
    const def = SOURCE;
    let alive = true, raf = 0, stopRuntime = () => {};
    const store = createStore(initialState({ id: def.id, label: def.label, caps: def.caps, live: false, connected: false }));
    const stopTheme = watchTheme(() => store.emit("theme"));
    setError(null);
    setReady(false);
    // Until the source runs, panels get a console with none of its ops (all optional).
    setC({ store, actions: createActions(store, {}) });
    if (!wanted) return () => { alive = false; stopTheme(); };
    def.start(store).then((runtime) => {
      if (!alive) { runtime.stop(); return; }
      stopRuntime = runtime.stop;
      const actions = createActions(store, runtime.ops);
      actions.selectDefault();
      let last = performance.now();
      const frame = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        runtime.tick?.(dt);
        tickPlayback(store, dt);
        store.emit("frame", dt);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      setC({ store, actions });
      setReady(true);
    }).catch((e: Error) => { if (alive) setError(`${def.label} couldn't start: ${e.message}`); });
    return () => { alive = false; cancelAnimationFrame(raf); stopRuntime(); stopTheme(); setC(null); };
  }, [attempt, wanted]);

  // The engine runs only in the browser, so the server renders a quiet placeholder.
  if (error && !standalone) return (
    <div className="boot">
      <p>{error}</p>
      <button className="btn sm" type="button" onClick={retry}>Try again</button>
    </div>
  );
  if (!c || (!ready && !standalone)) return <div className="boot">Loading Steward runs…</div>;
  return <ConsoleCtx.Provider value={c}>{children}</ConsoleCtx.Provider>;
}
