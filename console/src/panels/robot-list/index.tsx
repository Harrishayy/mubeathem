"use client";

import { useState } from "react";
import { useConsole, useTick } from "@/console/hooks";
import { PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Pill } from "@/ui/status";
import { Seg, EpisodeStrip } from "@/ui/controls";
import { EpisodeView } from "@/ui/media";
import { liveStatus, successRate, poseAt, doing } from "@/engine/timeline";
import { taskName } from "@/engine/task";
import type { Robot } from "@/engine/types";
import s from "./robot-list.module.css";

export const meta: PanelMeta = { title: "Robots", minHeight: 200, about: "Compact robot list for picking what to replay. Click a bar to open that episode." };

type Filter = string;

export default function RobotList() {
  const { st } = useConsole();
  const { collapsed } = usePanel();
  const [filter, setFilter] = useState<Filter>("all");
  useTick(["frame"], 300);
  useTick(["select", "robots"]);
  const robots = st.robots.filter((r) => filter === "all" || r.task === filter);
  const sel = st.selection.robotId ? st.byId[st.selection.robotId] : null;
  const tasks = [...new Set(st.robots.map((r) => r.task))];
  const filters: { value: Filter; label: string }[] = [{ value: "all", label: "All" }, ...tasks.map((k) => ({ value: k, label: taskName(k) }))];
  return (
    <>
      <PanelSub>{sel ? <>replaying <b>{sel.name}</b></> : `${st.robots.length} robots`}</PanelSub>
      {tasks.length > 1 && <div className="toolbar"><Seg label="Filter by task" options={filters} value={filter} onChange={setFilter} /><span className="eyebrow">{robots.length} shown</span></div>}
      {!collapsed && (robots.length ? <div>{robots.map((r) => <Row key={r.id} r={r} selected={r.id === st.selection.robotId} />)}</div> : <p className="empty">{st.source.note || "No robots yet."}</p>)}
    </>
  );
}

function Row({ r, selected }: { r: Robot; selected: boolean }) {
  const { st, actions } = useConsole();
  const ep = r.ep, phases = st.spec.phases;
  const t = r.imported ? ep.duration : Math.min(st.simNow - ep.start, ep.duration);
  const status = liveStatus(r);
  const { phase, u } = poseAt(ep, t);
  const last = r.history.slice(-20);
  const live = !!r.live && ep.outcome === "";
  const open = () => actions.select(r.id, live ? "live" : ep.id);
  const cls = [s.row, selected && s.selected, (status === "failed" || status === "stopped") && s.attn, status === "holding" && s.holdattn].filter(Boolean).join(" ");
  return (
    <div className={cls} role="button" tabIndex={0} aria-label={`Replay ${r.name}`} aria-pressed={selected} onClick={open} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}>
      <div className={s.thumb}><EpisodeView key={ep.id} ep={ep} still minimal t={() => (r.imported ? r.ep.duration : Math.min(st.simNow - r.ep.start, r.ep.duration))} /></div>
      <div className={s.main}>
        <div className={s.top}><span className={s.name}>{r.name}</span><Pill status={status} /></div>
        <div className={s.meta}>{r.model} · #{ep.n} · {doing(ep, t)}</div>
        <div className={s.prog}>{phases.map((p, i) => <i key={p} style={{ ["--p" as string]: `${i < phase ? 100 : i === phase ? Math.round(u * 100) : 0}%` }} />)}</div>
        <div className={s.foot}>
          <EpisodeStrip eps={r.history} live={live ? ep : null} onPick={(id) => actions.select(r.id, id)} max={10} />
          <span className={`${s.rate} mono`}>{last.length ? <><b>{Math.round(successRate(last) * 100)}%</b> last {last.length}</> : "—"}</span>
        </div>
      </div>
    </div>
  );
}
