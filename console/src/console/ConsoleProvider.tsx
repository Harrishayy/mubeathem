"use client";

// Creates the engine on Steward's runs and drives the frame loop. It sits in the root
// layout, so the fleet keeps following the runs dir while you switch tabs.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createStore } from "@/engine/store";
import { initialState } from "@/engine/state";
import { createActions } from "@/engine/actions";
import { tickPlayback } from "@/engine/playback";
import { readColors, watchTheme } from "@/engine/theme";
import { SOURCE } from "@/sources";
import { ConsoleCtx, type Console } from "./hooks";

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [c, setC] = useState<Console | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => { readColors(); }, []);

  useEffect(() => {
    const def = SOURCE;
    let alive = true, raf = 0, stopRuntime = () => {};
    const store = createStore(initialState({ id: def.id, label: def.label, caps: def.caps, live: false, connected: false }));
    const stopTheme = watchTheme(() => store.emit("theme"));
    setError(null);
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
    }).catch((e: Error) => { if (alive) setError(`${def.label} couldn't start: ${e.message}`); });
    return () => { alive = false; cancelAnimationFrame(raf); stopRuntime(); stopTheme(); setC(null); };
  }, [attempt]);

  // The engine runs only in the browser, so the server renders a quiet placeholder.
  if (error) return (
    <div className="boot">
      <p>{error}</p>
      <button className="btn sm" type="button" onClick={retry}>Try again</button>
    </div>
  );
  if (!c) return <div className="boot">Loading Steward runs…</div>;
  return <ConsoleCtx.Provider value={c}>{children}</ConsoleCtx.Provider>;
}
