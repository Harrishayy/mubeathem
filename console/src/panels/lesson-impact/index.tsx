"use client";

import { useConsole, useTick } from "@/console/hooks";
import { PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { wordsOf } from "@/engine/format";
import type { Episode, Lesson } from "@/engine/types";
import s from "./lesson-impact.module.css";

export const meta: PanelMeta = { title: "Lesson impact", minHeight: 160, about: "For each lesson: success on episodes that used it, against matching episodes that ran without it." };

const matches = (l: Lesson, ep: Episode) => {
  if (ep.task !== l.task) return false;
  const ws = wordsOf(ep.variant.subject), keys = l.applies_to;
  return keys.filter((w) => ws.has(w)).length >= Math.min(2, keys.length);
};
const rate = (eps: Episode[]) => (eps.length ? eps.filter((e) => e.outcome === "success").length / eps.length : null);

export default function LessonImpact() {
  const { st } = useConsole();
  const { collapsed } = usePanel();
  useTick(["lessons", "episode:done"], 1000);
  const rows = st.lessons.filter((l) => !l.retired).map((l) => {
    const relevant = st.done.filter((e) => matches(l, e) && e.outcome !== "stopped");
    // Real runs: lesson ids repeat across lesson files, so only count episodes that could have read this file.
    const sameFile = (e: Episode) => !l.file || (l.scope === "fleet" ? st.takes.find((t) => t.id === e.take)?.lessonsFile === l.file : e.take === l.scope);
    const withL = relevant.filter((e) => sameFile(e) && e.lessons.some((x) => x.id === l.id));
    const without = relevant.filter((e) => sameFile(e) && !e.lessons.some((x) => x.id === l.id));
    return { l, withL, without, a: rate(withL), b: rate(without) };
  }).filter((x) => x.withL.length > 0).sort((x, y) => (y.a ?? 0) - (y.b ?? 0) - ((x.a ?? 0) - (x.b ?? 0)));
  const best = rows[0];
  return (
    <>
      <PanelSub>{best && best.a != null && best.b != null ? <>best: <b>{best.l.id}</b> +{Math.round((best.a - best.b) * 100)} pts</> : "needs a few recalls first"}</PanelSub>
      {!collapsed && (rows.length ? (
        <ul className={s.list}>
          {rows.map(({ l, withL, without, a, b }) => (
            <li key={l.key || l.id} className={s.item}>
              <div className={s.top}><b>{l.id}</b><span className="subtle">{l.applies_to.join(" · ")}</span><span className={`${s.delta} ${a != null && b != null && a >= b ? s.up : s.down}`}>{a != null && b != null ? `${a >= b ? "+" : ""}${Math.round((a - b) * 100)} pts` : "—"}</span></div>
              <Bar label={`with it · ${withL.length}`} v={a} good />
              <Bar label={`without · ${without.length}`} v={b} />
            </li>
          ))}
        </ul>
      ) : <p className="empty">Impact shows once a lesson has been recalled. Robots recall a lesson when two of its words match their task.</p>)}
    </>
  );
}

function Bar({ label, v, good }: { label: string; v: number | null; good?: boolean }) {
  return (
    <div className={s.bar}>
      <span className={s.lab}>{label}</span>
      <span className={s.track}><i style={{ width: `${Math.round((v ?? 0) * 100)}%`, background: good ? "var(--ok)" : "var(--muted)" }} /></span>
      <span className={`${s.val} mono`}>{v == null ? "—" : `${Math.round(v * 100)}%`}</span>
    </div>
  );
}
