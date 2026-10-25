"use client";

import { useConsole, useTick } from "@/console/hooks";
import { PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Glyph, EventText } from "@/ui/status";
import { fmtClock } from "@/engine/format";
import { nameOf } from "@/engine/state";
import s from "./activity.module.css";

export const meta: PanelMeta = { title: "Activity", minHeight: 140, about: "The fleet's latest decisions as they happen. Pass kinds in props to narrow it." };

const DEFAULT_KINDS = ["hold", "escalate", "result", "lesson", "adapter"];

export default function Activity({ kinds = DEFAULT_KINDS, limit = 60 }: { kinds?: string[]; limit?: number }) {
  const { st, actions } = useConsole();
  const { collapsed } = usePanel();
  useTick(["log"], 700);
  const set = new Set(kinds);
  const rows: typeof st.log = [];
  for (let i = st.log.length - 1; i >= 0 && rows.length < limit; i--) if (set.has(st.log[i].kind)) rows.push(st.log[i]);
  const newest = rows[0];
  return (
    <>
      <PanelSub>{newest ? <>latest <b>{newest.kind}</b> · {fmtClock(newest.abs)}</> : "nothing yet"}</PanelSub>
      {!collapsed && (
        <ol className={s.list}>
          {rows.map((l) => {
            const ep = l.epId ? st.episodes[l.epId] : null;
            const r = ep ? st.byId[ep.robot] : null;
            const open = ep && r ? () => actions.replay(ep.robot, !r.imported && r.ep.id === ep.id ? "live" : ep.id, { t: l.at, paused: true }) : undefined;
            return (
              <li key={l.seq}>
                <button type="button" className={s.row} onClick={open} disabled={!open}>
                  <span className={`${s.at} mono`}>{fmtClock(l.abs)}</span>
                  <Glyph kind={l.kind} e={l.data} />
                  <span className={s.main}><b>{nameOf(st, l.robot)}</b> <EventText e={l.data} task={ep?.task || "pour"} /></span>
                </button>
              </li>
            );
          })}
          {!rows.length && <li className="empty">No matching events yet.</li>}
        </ol>
      )}
    </>
  );
}
