"use client";

import { useConsole, useTick } from "@/console/hooks";
import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { median } from "@/engine/format";
import { MUBIT_CFG, KEEP_TO_TRAIN } from "@/engine/world";
import s from "./mubit-tasks.module.css";

export const meta: PanelMeta = { title: "Mubit tasks", minHeight: 180, about: "Steward's three recurring tasks: calls, kept examples toward an adapter (where known), and current latency." };

export default function MubitTasks() {
  const { st } = useConsole();
  useTick(["mubit"], 700);
  useTick(["frame"], 1000);
  const entries = Object.entries(st.mubit);
  const known = entries.every(([, m]) => m.kept != null);
  return (
    <>
      <PanelSub>{entries.map(([k, m]) => (m.state === "serving" ? `${k} ✓` : m.state === "training" ? `${k} training` : m.kept == null ? `${k} ${m.calls} calls` : `${k} ${m.kept}/${KEEP_TO_TRAIN}`)).join(" · ")}</PanelSub>
      <div className={s.intro}>
        Mubit groups calls by model, instructions and output schema, keeps good examples of each, and trains an adapter once {KEEP_TO_TRAIN} are kept.
        {known ? " Plan examples count only when the attempt succeeded." : " Steward's logs don't say which calls Mubit kept or whether an adapter is serving; check the Mubit console for that. Counts below are calls through Mubit (Sapling checks aren't Mubit calls)."}
      </div>
      <div className={s.grid}>
        {entries.map(([k, m]) => {
          const left = m.state === "training" && m.trainStart != null ? Math.max(0, Math.ceil(MUBIT_CFG[k].trainFor - (st.simNow - m.trainStart))) : 0;
          const p50 = median(m.lat.slice(-40).map((x) => x.ms));
          const kept = m.kept;
          return (
            <section key={k} className={s.card}>
              <div className={s.top}><h3>{k}</h3><span className={`${s.state} ${s[m.state]}`}>{m.state === "serving" ? `${k}-v1 serving` : m.state === "training" ? `training · ${left} s left` : kept == null ? `${Math.min(m.calls, KEEP_TO_TRAIN)}/${KEEP_TO_TRAIN} calls` : `collecting ${kept}/${KEEP_TO_TRAIN}`}</span></div>
              <p className="muted">{MUBIT_CFG[k].label}</p>
              <div className={s.kv}><div><b>{m.calls}</b><span>calls</span></div><div><b>{kept ?? "—"}</b><span>{kept == null ? "kept · unknown" : "kept"}</span></div><div><b>{p50 ?? "—"}</b><span>p50 ms</span></div></div>
              <div className="progress" title={kept == null ? `${m.calls} calls; Mubit decides which it keeps` : `${Math.min(kept, KEEP_TO_TRAIN)} of ${KEEP_TO_TRAIN} examples`}><i style={{ width: `${Math.min(100, ((kept ?? m.calls) / KEEP_TO_TRAIN) * 100)}%` }} /></div>
            </section>
          );
        })}
      </div>
    </>
  );
}
