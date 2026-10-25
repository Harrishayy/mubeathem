"use client";

import { useState } from "react";
import { useConsole, useTick } from "@/console/hooks";
import { PanelActions, PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Seg } from "@/ui/controls";
import { fmtClock, median } from "@/engine/format";
import { nameOf } from "@/engine/state";
import { callResult, isSapling, viaLabel } from "@/engine/calls";
import type { CallRef } from "@/engine/types";
import s from "./model-calls.module.css";

export const meta: PanelMeta = { title: "Model calls", minHeight: 160, about: "Every plan, safety check and lesson call, to Mubit or Sapling: when, which robot, how long, what came back, and any failure. Select one to inspect it." };

type Task = "all" | "plan" | "verify" | "lesson" | "errors";
type Via = "all" | "mubit" | "sapling";
const MAX = 400;

export default function ModelCalls() {
  const { st, actions } = useConsole();
  const { collapsed } = usePanel();
  const [task, setTask] = useState<Task>("all");
  const [via, setVia] = useState<Via>("all");
  useTick(["mubit", "robots", "callsel"], 900);
  const pass = (c: CallRef) => (task === "all" || (task === "errors" ? !!c.error : c.task === task)) && (via === "all" || (via === "sapling" ? isSapling(c.via) : !isSapling(c.via)));
  const rows: CallRef[] = [];
  for (let i = st.calls.length - 1; i >= 0 && rows.length < MAX; i--) if (pass(st.calls[i])) rows.push(st.calls[i]);
  const errors = st.calls.filter((c) => c.error).length;
  const p50 = median(rows.slice(0, 100).map((c) => c.ms));
  return (
    <>
      <PanelSub><b>{st.calls.length.toLocaleString()}</b> calls{errors ? <> · <span className={s.bad}>{errors} failed</span></> : ""}{p50 != null ? ` · p50 ${p50} ms` : ""}</PanelSub>
      <PanelActions>
        <Seg label="Filter by service" value={via} onChange={setVia} options={[{ value: "all", label: "All" }, { value: "mubit", label: "Mubit" }, { value: "sapling", label: "Sapling" }]} />
      </PanelActions>
      <div className="toolbar">
        <Seg label="Filter by task" value={task} onChange={setTask} options={[{ value: "all", label: "All" }, { value: "plan", label: "plan" }, { value: "verify", label: "verify" }, { value: "lesson", label: "lesson" }, { value: "errors", label: "Failed" }]} />
        <span className="eyebrow">{rows.length >= MAX ? `newest ${MAX}` : `${rows.length} shown`}</span>
      </div>
      {!collapsed && (rows.length ? (
        <table className="tbl sticky">
          <thead><tr><th>Time</th><th>Robot</th><th>Task</th><th>Via</th><th>Latency</th><th>Returned</th></tr></thead>
          <tbody>
            {rows.map((c) => {
              const e = st.episodes[c.epId]?.events[c.idx];
              const on = st.callSel?.epId === c.epId && st.callSel.idx === c.idx;
              return (
                <tr key={`${c.epId}:${c.idx}`} className={`click${on ? " on" : ""}`} onClick={() => actions.selectCall(c)}>
                  <td className="n subtle">{fmtClock(c.abs, true)}</td>
                  <td className="n">{nameOf(st, c.robot)}</td>
                  <td className="n">{c.task}</td>
                  <td className="n">{viaLabel(c.via)}</td>
                  <td className="n">{c.ms} ms</td>
                  <td className={`${s.ret}${c.error ? ` ${s.bad}` : ""}`}>{e ? callResult(e) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="empty">No calls match. Calls appear as robots plan, check and write lessons.</p>)}
    </>
  );
}
