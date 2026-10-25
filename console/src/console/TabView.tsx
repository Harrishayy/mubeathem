"use client";

// Renders one tab from tabs.ts: its columns side by side, each a stack of panels.

import { tabById } from "@/tabs";
import { PANELS } from "@/panels";
import { useConsole } from "./hooks";
import { Panel } from "./Panel";

export function TabView({ tab }: { tab: string }) {
  const { st } = useConsole();
  const def = tabById(tab);
  // A panel whose meta.needs the running source can't meet is left out.
  const shown = (id: string) => (PANELS[id]?.meta.needs || []).every((n) => (st.source.caps as string[]).includes(n));
  if (!def) return <div className="empty">There is no “{tab}” tab.</div>;
  return (
    <main className="dash" style={{ gridTemplateColumns: def.columns.map((c) => c.width).join(" ") }} aria-label={`${def.label} tab`}>
      {def.columns.map((col) => (
        <div className="region" key={col.id} data-region={col.id} aria-label={col.label}>
          {col.panels.filter((p) => shown(p.id)).map((p) => <Panel key={`${def.id}/${p.id}/${p.title || ""}`} entry={p} tab={def.id} />)}
        </div>
      ))}
    </main>
  );
}
