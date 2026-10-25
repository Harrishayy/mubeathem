"use client";

// Creates the engine for the chosen data source and drives the frame loop. It sits in the
// root layout, so the fleet keeps running while you switch tabs. Switching source (top
// bar) builds a fresh engine for it.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createStore } from "@/engine/store";
import { initialState } from "@/engine/state";
import { createActions } from "@/engine/actions";
import { tickPlayback } from "@/engine/playback";
import { readColors, watchTheme } from "@/engine/theme";
import { SOURCES, sourceById } from "@/sources";
import { getHealth } from "@/services/health";
import { ConsoleCtx, type Console } from "./hooks";

const KEY = "steward.source";

/** The saved choice, else runs when the backend has any takes (or a run going), else the demo. */
async function initialSource(): Promise<string> {
  try { const saved = localStorage.getItem(KEY); if (sourceById(saved)) return saved!; } catch { /* storage blocked */ }
  try {
    const h = await getHealth();
    const runs = h.services.find((s) => s.id === "runs"), live = h.services.find((s) => s.id === "live");
    if (runs?.health.status === "ok" || live?.health.status === "ok") return "runs";
  } catch { /* no backend: a static export, or the server is down */ }
  return sourceById("demo") ? "demo" : SOURCES[0].id;
}

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [c, setC] = useState<Console | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { readColors(); initialSource().then(setSourceId); }, []);

  const switchSource = useCallback((id: string) => {
    if (!sourceById(id)) return;
    try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ }
    setSourceId(id);
  }, []);

  useEffect(() => {
    const def = sourceById(sourceId);
    if (!def) return;
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
      setC({ store, actions, sourceId: def.id, switchSource });
    }).catch((e: Error) => { if (alive) setError(`${def.label} couldn't start: ${e.message}`); });
    return () => { alive = false; cancelAnimationFrame(raf); stopRuntime(); stopTheme(); setC(null); };
  }, [sourceId, switchSource]);

  // The engine runs only in the browser, so the server renders a quiet placeholder.
  if (error) return (
    <div className="boot">
      <p>{error}</p>
      {SOURCES.filter((s) => s.id !== sourceId).map((s) => <button key={s.id} className="btn sm" type="button" onClick={() => switchSource(s.id)}>Open the {s.label.toLowerCase()} instead</button>)}
    </div>
  );
  if (!c) return <div className="boot">Loading {sourceById(sourceId)?.label.toLowerCase() || "the console"}…</div>;
  return <ConsoleCtx.Provider value={c}>{children}</ConsoleCtx.Provider>;
}
