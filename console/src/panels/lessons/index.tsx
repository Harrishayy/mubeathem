"use client";

import { useState } from "react";
import { useConsole, useTick } from "@/console/hooks";
import { PanelActions, PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Seg } from "@/ui/controls";
import { fmtClock, fmtP } from "@/engine/format";
import { taskName } from "@/engine/task";
import { nameOf } from "@/engine/state";
import s from "./lessons.module.css";

export const meta: PanelMeta = { title: "Lessons", minHeight: 160, about: "The fleet's shared lessons: what each says, which words recall it, how often it was used and how often that worked." };

type Filter = string;

export default function Lessons() {
  const { st, actions } = useConsole();
  const { collapsed } = usePanel();
  const [filter, setFilter] = useState<Filter>("all");
  useTick(["lessons"], 800);
  const active = st.lessons.filter((l) => !l.retired);
  const uses = active.reduce((a, l) => a + l.uses, 0), succ = active.reduce((a, l) => a + l.successes, 0);
  const rows = st.lessons.filter((l) => filter === "all" || l.task === filter).slice().reverse();
  const tasks = [...new Set(st.lessons.map((l) => l.task))];
  const files = new Set(st.lessons.map((l) => l.file).filter(Boolean));
  return (
    <>
      <PanelSub><b>{active.length}</b> active{uses ? ` · ${Math.round((succ / uses) * 100)}% success when used` : ""} · recalled when two applies-to words match</PanelSub>
      {tasks.length > 1 && <PanelActions><Seg label="Filter lessons by task" options={[{ value: "all" as Filter, label: "All tasks" }, ...tasks.map((k) => ({ value: k, label: taskName(k) }))]} value={filter} onChange={setFilter} /></PanelActions>}
      {!collapsed && (rows.length ? (
        <table className="tbl sticky">
          <thead><tr><th>Lesson</th><th>Applies to</th><th>From</th>{files.size > 0 && <th>File</th>}<th>Used</th><th>Success when used</th><th>Written</th><th /></tr></thead>
          <tbody>
            {rows.map((l) => {
              const rate = l.uses ? l.successes / l.uses : null;
              return (
                <tr key={l.key || l.id} className={l.retired ? s.retired : ""}>
                  <td>
                    <div className={s.text}>{l.text}</div>
                    <div className={s.meta}>{l.id} · {taskName(l.task)}{l.retired ? " · retired" : ""}{Object.entries(l.settings).map(([k, v]) => <span key={k} className="chip solid">{k} {fmtP(k, v)}</span>)}</div>
                  </td>
                  <td><div className="chips">{l.applies_to.map((w) => <span key={w} className="chip">{w}</span>)}</div></td>
                  <td className="n">{nameOf(st, l.source_robot)}</td>
                  {files.size > 0 && <td className="n subtle" title={l.file ? `runs/${l.file}` : undefined}>{l.scope === "fleet" ? "fleet" : l.scope}</td>}
                  <td className="n">{l.uses}×</td>
                  <td className="n">{rate == null ? <span className="subtle">not used yet</span> : <><span className={`bar ${rate >= 0.6 ? "ok" : "bad"}`}><i style={{ width: `${Math.round(rate * 100)}%` }} /></span> {Math.round(rate * 100)}%</>}</td>
                  <td className="n">{l.created_abs != null ? fmtClock(l.created_abs) : "—"}</td>
                  <td>{actions.can.retireLesson && <button className="btn sm ghost" type="button" onClick={() => actions.retireLesson(l)}>{l.retired ? "Restore" : "Retire"}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="empty">No lessons for this task yet. A robot writes one after its first failure.</p>)}
    </>
  );
}
