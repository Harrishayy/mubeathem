"use client";

import { useState } from "react";
import { useConsole, useSize, useTick } from "@/console/hooks";
import { PanelActions, PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Pill, Glyph, EventText } from "@/ui/status";
import { Seg, EpisodeStrip } from "@/ui/controls";
import { EpisodeView } from "@/ui/media";
import { viaLabel } from "@/engine/calls";
import { liveStatus, successRate, stateAt, poseAt, doing } from "@/engine/timeline";
import { TASKS } from "@/engine/world";
import type { Robot, State } from "@/engine/types";
import s from "./robot-grid.module.css";

export const meta: PanelMeta = { title: "Robots", minHeight: 260, mobileHeight: "auto", about: "Every robot: its take video, practice-world scene or simulation, status, phase and attempt history. Click one to replay it." };

type Filter = "all" | "active" | "holding" | "failing";
const FILTERS: { value: Filter; label: string }[] = [{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "holding", label: "Holding" }, { value: "failing", label: "Failing" }];

function pass(st: State, r: Robot, f: Filter) {
  if (f === "all") return true;
  const status = liveStatus(st, r);
  if (f === "active") return status === "running" || status === "deciding";
  if (f === "holding") return status === "holding" || status === "stopped";
  const last = r.history.slice(-6);
  return last.length > 0 && successRate(last) < 0.5;
}

export default function RobotGrid() {
  const { st } = useConsole();
  const { collapsed } = usePanel();
  const [filter, setFilter] = useState<Filter>("all");
  const [ref, size] = useSize<HTMLDivElement>();
  useTick(["frame"], 250);
  useTick(["robots"]);
  const robots = st.robots.filter((r) => pass(st, r, filter));
  const holding = st.robots.filter((r) => liveStatus(st, r) === "holding").length;
  const working = st.robots.filter((r) => r.kind === "run" && r.live).length;
  const failing = st.robots.filter((r) => r.history.length && successRate(r.history.slice(-6)) < 0.5).length;

  // Fit every tile in the panel when there's room; otherwise scroll inside it.
  const cols = Math.max(1, Math.min(5, Math.floor((size.w || 900) / 270)));
  const rows = Math.max(1, Math.ceil(robots.length / cols));
  const stacked = typeof window !== "undefined" && window.matchMedia("(max-width: 1100px)").matches;
  const fits = !stacked && size.h / rows >= 220;

  return (
    <>
      <PanelSub><b>{st.robots.length}</b> robots{working ? ` · ${working} working now` : ""}{holding ? ` · ${holding} holding` : ""}{failing ? ` · ${failing} failing often` : ""}</PanelSub>
      <PanelActions><Seg label="Filter robots" options={FILTERS} value={filter} onChange={setFilter} /></PanelActions>
      <div ref={ref} className={s.wrap}>
        {!collapsed && (
          <div className={s.grid} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: fits ? `repeat(${rows}, minmax(0, 1fr))` : undefined, gridAutoRows: fits ? undefined : "240px", height: fits ? "100%" : undefined }}>
            {robots.map((r) => <Tile key={r.id} r={r} />)}
            {!robots.length && <p className="empty">{st.robots.length ? "No robots match this filter." : st.source.note || "No robots yet."}</p>}
          </div>
        )}
      </div>
    </>
  );
}

function Tile({ r }: { r: Robot }) {
  const { st, actions } = useConsole();
  const ep = r.ep, task = TASKS[r.task];
  const t = r.imported ? ep.duration : Math.min(st.simNow - ep.start, ep.duration);
  const status = r.queued ? "queued" : liveStatus(st, r);
  const sa = stateAt(ep, t), { phase, u } = poseAt(ep, t);
  const last = r.history.slice(-20);
  const live = r.kind === "run" ? !!r.live && ep.outcome === "" : !r.imported;
  const open = () => actions.replay(r.id, live ? "live" : ep.id);
  const attn = status === "failed" || status === "stopped" ? s.attn : status === "holding" ? s.holdattn : "";
  return (
    <article className={`${s.tile} ${attn}`} tabIndex={0} role="button" aria-label={`Replay ${r.name}`} onClick={open} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}>
      <div className={s.head}>
        <div className={s.id}><div className={s.name}>{r.name}</div><div className={s.sub}>{r.model} · {task.name} · {r.env}</div></div>
        <Pill status={status} />
      </div>
      <div className={s.view}>
        <EpisodeView key={ep.id} ep={ep} still minimal t={() => (r.imported ? r.ep.duration : Math.min(st.simNow - r.ep.start, r.ep.duration))} />
        {ep.world !== "text" && <span className={`vp-tag ${s.tl}`}>{doing(ep, t)}</span>}
        {sa.kind === "decide" && ep.world !== "text" && <span className={`vp-tag ${s.tr}`}>{sa.seg.task} via {viaLabel(sa.seg.via)}</span>}
        {ep.world !== "text" && <span className={`vp-tag ${s.bl}`}>#{ep.n} · {ep.take ? `${ep.take} · attempt ${ep.attempt}` : ep.variant.subject}</span>}
      </div>
      <div className={s.phases}>
        {task.phases.map((p, i) => (
          <span key={p} className={i === phase && u < 1 ? s.on : ""}><i style={{ ["--p" as string]: `${i < phase ? 100 : i === phase ? Math.round(u * 100) : 0}%` }} /><b>{p}</b></span>
        ))}
      </div>
      <div className={s.last}>
        {r.lastEv ? <><Glyph kind={r.lastEv.kind} e={r.lastEv} /><span className={s.txt}><EventText e={r.lastEv} task={r.task} /></span></> : <><Glyph kind="plan" /><span className={s.txt}>Recalling lessons and asking Mubit for a plan.</span></>}
      </div>
      <div className={s.foot}>
        <EpisodeStrip eps={r.history} live={live ? ep : null} onPick={(id) => actions.replay(r.id, id)} max={22} />
        <span className={`${s.rate} mono`}>{last.length ? <><b>{Math.round(successRate(last) * 100)}%</b> last {last.length}</> : "no episodes"}</span>
      </div>
    </article>
  );
}
