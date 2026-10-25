"use client";

import { useConsole, useTick } from "@/console/hooks";
import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { fmtP, SHORT } from "@/engine/format";
import { taskOf } from "@/engine/world";
import { selectedEpisode, nameOf } from "@/engine/state";
import s from "./sampled-plans.module.css";

export const meta: PanelMeta = { title: "Sampled plans", minHeight: 140, needs: ["samples"], about: "The plans Mubit sampled, how the verifier ranked them, which were dropped, and the policy it applies. Demo only: Steward asks for one plan per attempt." };

export default function SampledPlans() {
  const { st } = useConsole();
  useTick(["select"]);
  const ep = selectedEpisode(st);
  if (!ep) return <p className="empty">Pick a robot to see its plans.</p>;
  const task = taskOf(ep.task), keys = Object.keys(task.params);
  const many = ep.cands.length > 1, picked = ep.cands[ep.chosen];
  const dropped = ep.cands.filter((c) => c.violation).length;
  return (
    <>
      <PanelSub>{many ? <>picked <b>#{ep.chosen + 1}</b> of {ep.cands.length} · score {picked.score.toFixed(2)}{dropped ? ` · ${dropped} dropped` : ""}</> : "one plan, as logged"}</PanelSub>
      <div className={s.scroll}>
        <table className={s.table}>
          <thead><tr><th>#</th>{keys.map((k) => <th key={k}>{SHORT[k] || k}</th>)}{many && <th>score</th>}</tr></thead>
          <tbody>
            {ep.cands.map((c, i) => {
              const plan = i === ep.chosen ? ep.plan : c.plan;
              return (
                <tr key={i} className={i === ep.chosen ? s.picked : c.violation ? s.dropped : ""} title={c.violation || undefined}>
                  <td>{i + 1}{i === ep.chosen ? " · picked" : c.violation ? " · dropped" : ""}</td>
                  {keys.map((k) => <td key={k}>{fmtP(k, plan[k])}</td>)}
                  {many && <td><span className={s.score}><i style={{ width: `${Math.round(c.score * 100)}%` }} /></span>{c.score.toFixed(2)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={s.why}>
        <p>{ep.justification}</p>
        {ep.cands.filter((c) => c.violation).map((c, i) => <p key={i} className="subtle">Dropped: {c.violation}</p>)}
        {ep.lessons.length > 0 && <div className="chips">{ep.lessons.map((l) => <span key={l.id} className="chip solid" title={l.text}>{l.id} · from {nameOf(st, l.source)}</span>)}</div>}
        <details><summary>Safety policy the verifier applies</summary><ol>{task.policy.map((p) => <li key={p}>{p}</li>)}</ol></details>
      </div>
    </>
  );
}
