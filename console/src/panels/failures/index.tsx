"use client";

import { useState } from "react";
import { useConsole, useTick } from "@/console/hooks";
import { PanelActions, PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Pill } from "@/ui/status";
import { Seg } from "@/ui/controls";
import { EpisodeView } from "@/ui/media";
import { fmtClock } from "@/engine/format";
import { planBrief, STATUS_LABEL } from "@/engine/text";
import { nextAttempt, planDiff, fmtChange } from "@/engine/history";
import type { Episode } from "@/engine/types";
import s from "./failures.module.css";

export const meta: PanelMeta = { title: "Failures", minHeight: 220, about: "Every attempt that failed or stopped: the moment it went wrong, its settings and reason, the lesson it wrote, and what the next attempt changed." };

type F = "all" | "failed" | "stopped";
const MAX = 60;

export default function Failures() {
  const { st } = useConsole();
  const { collapsed } = usePanel();
  const [f, setF] = useState<F>("all");
  useTick(["episode:done", "robots"], 1000);
  const all = st.done.filter((e) => e.outcome === "failed" || e.outcome === "stopped");
  const rows = all.filter((e) => f === "all" || e.outcome === f).slice(-MAX).reverse();
  const fixed = all.filter((e) => nextAttempt(st, e)?.outcome === "success").length;
  return (
    <>
      <PanelSub><b>{all.filter((e) => e.outcome === "failed").length}</b> failed · {all.filter((e) => e.outcome === "stopped").length} stopped · {fixed} fixed by the next attempt</PanelSub>
      <PanelActions><Seg label="Filter failures" value={f} onChange={setF} options={[{ value: "all", label: "All" }, { value: "failed", label: "Failed" }, { value: "stopped", label: "Stopped" }]} /></PanelActions>
      {!collapsed && (rows.length ? <ol className={s.list}>{rows.map((ep) => <Card key={ep.id} ep={ep} />)}</ol>
        : <p className="empty">No failures{f === "all" ? "" : ` that ${f}`} yet. When an attempt spills or a check stops a robot, it shows here with what changed next.</p>)}
    </>
  );
}

function Card({ ep }: { ep: Episode }) {
  const { st, actions } = useConsole();
  const r = st.byId[ep.robot], nx = nextAttempt(st, ep);
  const changes = nx ? planDiff(ep.plan, nx.plan, ep.task) : [];
  const lesson = ep.events.find((e) => e.kind === "lesson")?.lesson;
  const stop = ep.events.find((e) => e.kind === "escalate" || e.kind === "error");
  const at = ep.resultAt ?? ep.failAt ?? (stop ? stop.at : ep.duration);
  return (
    <li className={s.card}>
      <button type="button" className={s.media} onClick={() => actions.replay(ep.robot, ep.id, { t: Math.max(0, at - 2) })} aria-label={`Watch ${r?.name} attempt fail`}>
        <EpisodeView ep={ep} still minimal t={() => at} />
        <span className="vp-tag">{ep.world === "isaac" && ep.video ? "result frame" : ep.world === "text" ? "text world" : "at the failure"}</span>
      </button>
      <div className={s.body}>
        <div className={s.head}>
          <b>{r?.name}</b>
          <span className="subtle">{ep.take ? `${ep.take} · attempt ${ep.attempt}` : `#${ep.n}`} · {fmtClock(ep.start)}</span>
          <span className="grow" />
          <Pill status={ep.outcome} />
        </div>
        <p className={s.reason}>{ep.reason || STATUS_LABEL[ep.outcome]}</p>
        <div className={s.kv}><span>Tried</span><span className="mono">{planBrief(ep.plan, ep.task) || "no plan was made"}</span></div>
        {stop && <div className={s.kv}><span>{stop.kind === "error" ? "Error" : "Stopped"}</span><span>{stop.kind === "error" ? `${stop.where}: ${stop.error}` : stop.reason}</span></div>}
        {lesson && <div className={s.kv}><span>Learned</span><span><b>{lesson.id}</b> {lesson.text}</span></div>}
        <div className={s.kv}>
          <span>Next</span>
          <span>{nx ? <>{changes.length ? changes.map(fmtChange).join(" · ") : "same settings"} → <span className={nx.outcome === "success" ? s.ok : nx.outcome ? s.bad : ""}>{nx.outcome ? STATUS_LABEL[nx.outcome].toLowerCase() : "running"}</span></> : <span className="subtle">{ep.take ? "no retry in this take" : "no later episode yet"}</span>}</span>
        </div>
        <div className={s.acts}>
          <button className="btn sm primary" type="button" onClick={() => actions.replay(ep.robot, ep.id, { t: Math.max(0, at - 2) })}>Watch the failure</button>
          {nx && <button className="btn sm" type="button" onClick={() => actions.replay(nx.robot, r?.ep.id === nx.id && r.live ? "live" : nx.id)}>Watch the retry</button>}
        </div>
      </div>
    </li>
  );
}
