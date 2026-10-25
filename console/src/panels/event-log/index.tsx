"use client";

import { useState } from "react";
import { useConsole, useTick } from "@/console/hooks";
import { PanelActions, PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Glyph, EventText } from "@/ui/status";
import { fmtClock } from "@/engine/format";
import { toJsonl } from "@/engine/log";
import { nameOf } from "@/engine/state";
import s from "./event-log.module.css";

export const meta: PanelMeta = { title: "Event log", minHeight: 200, about: "Every Steward event across the fleet, newest first, filterable by kind and robot. Select a row for its detail." };

const KINDS = ["all", "plan", "safety", "hold", "escalate", "result", "lesson", "call", "error"];



export default function EventLog() {
  const { st, actions } = useConsole();
  const { collapsed } = usePanel();
  const [kind, setKind] = useState("all");
  const [robot, setRobot] = useState("all");
  const [hover, setHover] = useState(false);
  useTick(["log", "logsel", "robots"], hover ? 4000 : 900);
  const rows = st.log.filter((l) => (kind === "all" || l.kind === kind) && (robot === "all" || l.robot === robot));
  const shown = rows.slice(-300).reverse();
  const copy = async () => {
    const list = rows.slice(-500);
    try { await navigator.clipboard.writeText(toJsonl(list)); actions.toast(`Copied ${list.length} events as JSONL.`); }
    catch { actions.toast("Copying isn't allowed here. Select rows in the table instead."); }
  };
  return (
    <>
      <PanelSub><b>{st.log.length.toLocaleString()}</b> events · {rows.length.toLocaleString()} match · newest {st.log.length ? fmtClock(st.log[st.log.length - 1].abs) : "—"}</PanelSub>
      <PanelActions><button className="btn sm" type="button" onClick={copy}>Copy as JSONL</button></PanelActions>
      <div className="toolbar">
        <div className={s.kinds}>
          {KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={k === kind} onClick={() => setKind(k)}>
              {k !== "all" && <Glyph kind={k === "error" ? "escalate" : k} e={k === "safety" ? { label: "supported", status: "decided" } : k === "result" ? { success: true } : null} />}{k}
            </button>
          ))}
        </div>
        <select className="sel sm" aria-label="Filter by robot" value={robot} onChange={(e) => setRobot(e.target.value)}>
          <option value="all">All robots</option>
          {st.robots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          <option value="steward">Take headers</option>
        </select>
      </div>
      {!collapsed && (shown.length ? (
        <table className="tbl" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          <thead><tr><th>Time</th><th>Robot</th><th>Kind</th><th>Event</th></tr></thead>
          <tbody>
            {shown.map((l) => {
              const ep = l.epId ? st.episodes[l.epId] : null;
              return (
                <tr key={l.seq} className={`click${st.logSel === l.seq ? " on" : ""}`} onClick={() => actions.selectLog(l.seq)}>
                  <td className="n subtle">{fmtClock(l.abs, true)}</td>
                  <td className="n">{nameOf(st, l.robot)}</td>
                  <td><span className={s.kind}><Glyph kind={l.kind} e={l.data} />{l.kind}</span></td>
                  <td className={s.sum}><EventText e={l.data} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="empty">No events match these filters.</p>)}
    </>
  );
}
