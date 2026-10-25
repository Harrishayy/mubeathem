"use client";

import { useConsole, useTick } from "@/console/hooks";
import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { median } from "@/engine/format";
import s from "./mubit-tasks.module.css";

export const meta: PanelMeta = { title: "Mubit tasks", minHeight: 180, about: "Steward's recurring Mubit tasks, from the logs: calls, failed calls and current latency." };

export default function MubitTasks() {
  const { st } = useConsole();
  useTick(["mubit"], 700);
  const entries = Object.entries(st.mubit);
  return (
    <>
      <PanelSub>{entries.length ? entries.map(([k, m]) => `${k} ${m.calls} call${m.calls === 1 ? "" : "s"}`).join(" · ") : "no Mubit calls yet"}</PanelSub>
      <div className={s.intro}>
        Mubit groups calls by model, instructions and output schema, and decides on its side which it keeps and trains on. Steward&apos;s logs record each call, not that decision, so check the Mubit console for kept examples and adapters. Sapling checks aren&apos;t Mubit calls.
      </div>
      <div className={s.grid}>
        {entries.map(([k, m]) => (
          <section key={k} className={s.card}>
            <div className={s.top}><h3>{k}</h3>{m.errors > 0 && <span className={s.state}>{m.errors} failed</span>}</div>
            {st.spec.tasks[k] && <p className="muted">{st.spec.tasks[k].label}</p>}
            <div className={s.kv}><div><b>{m.calls}</b><span>calls</span></div><div><b>{m.errors}</b><span>failed</span></div><div><b>{median(m.lat.slice(-40)) ?? "—"}</b><span>p50 ms</span></div></div>
          </section>
        ))}
        {!entries.length && <p className="empty">{st.source.note || "No Mubit calls in the runs yet."}</p>}
      </div>
    </>
  );
}
