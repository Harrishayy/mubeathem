"use client";

import { useEffect, useRef, useState } from "react";
import { useConsole, useFrame, useTick } from "@/console/hooks";
import { PanelActions, PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Glyph, EventText } from "@/ui/status";
import { DECISION_KINDS, eventIndexAt } from "@/engine/timeline";
import { selectedEpisode } from "@/engine/state";
import { callFor, callResult, viaLabel } from "@/engine/calls";
import s from "./decision-trace.module.css";

export const meta: PanelMeta = { title: "Decision trace", minHeight: 120, about: "The selected episode's Steward events and model calls, in step with the playhead. Click one to jump there and inspect its call." };

export default function DecisionTrace() {
  const { st, actions } = useConsole();
  const { collapsed } = usePanel();
  useTick(["select", "callsel"]);
  const ep = selectedEpisode(st);
  const [pos, setPos] = useState({ idx: -1, now: -1 });
  const [calls, setCalls] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);

  useFrame(() => {
    if (!ep || collapsed) return;
    const p = eventIndexAt(ep, st.playback.t);
    if (p.idx !== pos.idx || p.now !== pos.now) setPos(p);
  });
  // keep the current decision in view inside the panel
  useEffect(() => {
    const list = listRef.current, row = list?.querySelector<HTMLElement>(`[data-i="${pos.now}"]`);
    const body = list?.closest(".panel-body") as HTMLElement | null;
    if (!row || !body) return;
    const top = row.offsetTop - list!.offsetTop;
    if (top < body.scrollTop || top > body.scrollTop + body.clientHeight - 50) body.scrollTop = Math.max(0, top - 60);
  }, [pos.now]);

  if (!ep) return <p className="empty">Pick a robot to see its decisions.</p>;
  const n = ep.events.filter((e) => DECISION_KINDS.has(e.kind)).length;
  const cur = ep.events[pos.now];
  return (
    <>
      <PanelSub><b>{n}</b> decisions{cur ? ` · now ${cur.kind}` : ""}</PanelSub>
      <PanelActions><label className="check"><input type="checkbox" checked={calls} onChange={(e) => setCalls(e.target.checked)} /> Model calls</label></PanelActions>
      <ol ref={listRef} className={s.list}>
        {ep.events.map((e, i) => {
          if (e.kind === "call" && !calls) return null;
          const ci = e.kind === "call" ? i : callFor(ep, i);
          const picked = st.callSel?.epId === ep.id && st.callSel.idx === ci && ci >= 0;
          const cls = [s.row, e.kind === "call" && s.call, e.kind === "call" && e.error && s.err, i > pos.idx && s.future, i === pos.now && s.now, picked && e.kind === "call" && s.picked].filter(Boolean).join(" ");
          return (
            <li key={i} data-i={i} className={cls} onClick={() => { actions.seek(e.at); if (ci >= 0) actions.selectCallAt(ep, ci); }}>
              <span className={s.at}>{e.at.toFixed(2)}</span>
              <Glyph kind={e.kind} e={e} />
              <div>
                <div className={s.k}>{e.kind === "call" ? `${e.task} via ${viaLabel(e.via)}${e.ms != null ? ` · ${e.ms} ms` : ""}` : e.kind}</div>
                <div className={s.d}>{e.kind === "call" ? callResult(e) : <EventText e={e} />}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
