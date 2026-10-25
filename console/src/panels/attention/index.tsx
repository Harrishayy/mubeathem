"use client";

import { useConsole, useTick } from "@/console/hooks";
import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Glyph } from "@/ui/status";
import { liveStatus, successRate } from "@/engine/timeline";
import type { Robot, State } from "@/engine/types";
import s from "./attention.module.css";

export const meta: PanelMeta = { title: "Needs attention", minHeight: 120, about: "Robots holding for a person, stopped for an operator, or failing often." };

interface Item { r: Robot; rank: number; kind: string; e?: Record<string, unknown>; text: string; epId: string }

function items(st: State): Item[] {
  const out: Item[] = [];
  for (const r of st.robots) {
    if (r.imported) continue;
    const status = liveStatus(r), last = r.history[r.history.length - 1];
    const failedCall = r.ep.events.find((e) => e.kind === "call" && e.error);
    if (status === "holding") out.push({ r, rank: 0, kind: "hold", text: `Holding now during #${r.ep.n}: ${[...r.ep.events].reverse().find((e) => e.kind === "hold")?.reason || "the last check wasn't safe"}`, epId: "live" });
    else if (failedCall && r.ep.outcome === "stopped") out.push({ r, rank: 1, kind: "escalate", text: `#${r.ep.n}: a ${failedCall.task} call failed (${failedCall.error}), so it stopped.`, epId: r.ep.id });
    else if (last?.outcome === "stopped") out.push({ r, rank: 1, kind: "escalate", text: `#${last.n} stopped for an operator. ${last.reason}`, epId: last.id });
    else if (last?.outcome === "failed") out.push({ r, rank: 2, kind: "result", e: { success: false }, text: `#${last.n} failed. ${last.reason}`, epId: last.id });
    else {
      const recent = r.history.slice(-6);
      if (recent.length >= 4 && successRate(recent) < 0.5) out.push({ r, rank: 3, kind: "result", e: { success: false }, text: `${recent.filter((e) => e.outcome === "success").length} of the last ${recent.length} episodes succeeded.`, epId: recent[recent.length - 1].id });
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

export default function Attention() {
  const { st, actions } = useConsole();
  useTick(["frame"], 1000);
  const list = items(st);
  return (
    <>
      <PanelSub>{list.length ? <><b>{list.length}</b> need attention</> : "all clear"}</PanelSub>
      {list.length ? (
        <ul className={s.list}>
          {list.map((it) => (
            <li key={it.r.id}>
              <button type="button" className={s.row} onClick={() => actions.replay(it.r.id, it.epId)}>
                <Glyph kind={it.kind} e={it.e} />
                <span className={s.name}>{it.r.name}</span>
                <span className={s.text}>{it.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="empty">Nothing needs attention right now. Holds, stops and repeated failures show up here.</p>}
    </>
  );
}
