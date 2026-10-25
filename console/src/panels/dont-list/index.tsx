"use client";

import { useState } from "react";
import { useConsole, useTick } from "@/console/hooks";
import { PanelActions, PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Seg } from "@/ui/controls";
import { fmtP, SHORT } from "@/engine/format";
import { TASKS } from "@/engine/world";
import { planBrief } from "@/engine/text";
import { nextAttempt, settingSplits, type SettingSplit } from "@/engine/history";
import type { Episode, TaskKey } from "@/engine/types";
import s from "./dont-list.module.css";

export const meta: PanelMeta = { title: "What not to do", minHeight: 200, about: "What the failures teach: settings ranges that failed against ones that worked, the lesson each failure wrote, and the conditions robots stopped on." };

export default function DontList() {
  const { st, actions } = useConsole();
  const { collapsed } = usePanel();
  useTick(["episode:done", "lessons", "robots"], 1500);
  const tasks = [...new Set(st.done.map((e) => e.task))] as TaskKey[];
  const [pick, setPick] = useState<TaskKey | null>(null);
  const task = pick && tasks.includes(pick) ? pick : tasks[0] || "pour";
  const eps = st.done.filter((e) => e.task === task);
  const splits = settingSplits(eps, task);
  const sep = splits.filter((x) => x.separated);
  const learned = eps.filter((e) => e.lessonWritten).slice(-40).reverse();
  const stops = new Map<string, Episode[]>();
  for (const e of eps) if (e.outcome === "stopped") { const k = (e.reason || "Stopped").slice(0, 140); stops.set(k, [...(stops.get(k) || []), e]); }

  return (
    <>
      <PanelSub>{sep.length ? <><b>{sep.length}</b> setting{sep.length > 1 ? "s" : ""} separate failures from successes · {learned.length} lessons</> : `${learned.length} lessons from failures`}</PanelSub>
      {tasks.length > 1 && <PanelActions><Seg label="Task" value={task} onChange={setPick} options={tasks.map((k) => ({ value: k, label: TASKS[k].name.split(" ")[0] }))} /></PanelActions>}
      {!collapsed && (
        <div className={s.wrap}>
          <section>
            <h4>Settings that failed</h4>
            {splits.length ? (
              <>
                {splits.slice(0, 4).map((x) => <Split key={x.k} x={x} task={task} />)}
                <p className={s.note}>From {eps.filter((e) => e.outcome === "failed").length} failed and {eps.filter((e) => e.outcome === "success").length} successful plans. Ranges are what was tried, not a model of the physics.</p>
              </>
            ) : <p className="empty">Needs at least one failed and one successful attempt.</p>}
          </section>

          <section>
            <h4>What each failure taught</h4>
            {learned.length ? (
              <ol className={s.lessons}>
                {learned.map((ep) => {
                  const l = ep.events.find((e) => e.kind === "lesson")?.lesson, nx = nextAttempt(st, ep);
                  const stored = st.lessons.find((x) => x.id === ep.lessonWritten && (!ep.take || x.file?.includes(ep.take) || x.scope === "fleet"));
                  return (
                    <li key={ep.id}>
                      <div className={s.dont}><span className={s.tag}>Don&apos;t</span><span><span className="mono">{planBrief(ep.plan, ep.task)}</span> for {ep.variant.subject}: {ep.reason}</span></div>
                      <div className={s.do}><span className={s.tag}>Do</span><span>{l?.text || stored?.text || ep.lessonWritten}</span></div>
                      <div className={s.since}>
                        <button type="button" onClick={() => actions.replay(ep.robot, ep.id, { t: Math.max(0, (ep.resultAt ?? ep.duration) - 2) })}>{st.byId[ep.robot]?.name} {ep.take ? `attempt ${ep.attempt}` : `#${ep.n}`}</button>
                        {nx && <> · next attempt <span className={nx.outcome === "success" ? s.ok : s.bad}>{nx.outcome || "running"}</span></>}
                        {stored && stored.uses > 0 && <> · recalled {stored.uses}×, {stored.successes} succeeded</>}
                        {stored?.retired && <> · retired</>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="empty">No lessons yet. A robot writes one after each failed attempt.</p>}
          </section>

          {stops.size > 0 && (
            <section>
              <h4>When robots stopped instead of acting</h4>
              <ul className={s.stops}>
                {[...stops.entries()].sort((a, b) => b[1].length - a[1].length).map(([reason, list]) => (
                  <li key={reason}><span className="mono">{list.length}×</span><span>{reason}</span><button className="btn sm ghost" type="button" onClick={() => actions.replay(list[list.length - 1].robot, list[list.length - 1].id)}>Latest</button></li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}

/** One setting: the range failed plans used against the range successful plans used, on the setting's full scale. */
function Split({ x, task }: { x: SettingSplit; task: TaskKey }) {
  const [lo, hi] = TASKS[task].params[x.k], pct = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`;
  const band = (r: [number, number]) => ({ left: pct(r[0]), width: `calc(${pct(r[1])} - ${pct(r[0])} + 2px)` });
  return (
    <div className={s.split}>
      <div className={s.splitHead}>
        <b>{SHORT[x.k] || x.k}</b>
        <span>{x.separated
          ? <>failed around <span className={s.bad}>{fmtP(x.k, x.failedMedian)}</span>, worked around <span className={s.ok}>{fmtP(x.k, x.okMedian)}</span>: keep it {x.dir === "hi" ? "lower" : "higher"}</>
          : <span className="subtle">no clear split ({fmtP(x.k, x.failedMedian)} vs {fmtP(x.k, x.okMedian)})</span>}</span>
      </div>
      <div className={s.scale} aria-label={`${x.k}: failed ${fmtP(x.k, x.failed[0])}–${fmtP(x.k, x.failed[1])}, worked ${fmtP(x.k, x.ok[0])}–${fmtP(x.k, x.ok[1])}`}>
        <span className={s.failBand} style={band(x.failed)} />
        <span className={s.okBand} style={band(x.ok)} />
        <span className={s.lo}>{fmtP(x.k, lo)}</span><span className={s.hi}>{fmtP(x.k, hi)}</span>
      </div>
    </div>
  );
}
