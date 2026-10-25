"use client";

import { useConsole, useSize, useTick } from "@/console/hooks";
import { PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { TASKS } from "@/engine/world";
import { successRate } from "@/engine/timeline";
import s from "./learning-curve.module.css";

export const meta: PanelMeta = { title: "Learning curve", minHeight: 160, mobileHeight: "240px", about: "Fleet success rate over attempts, with a tick where each lesson was written (and, in the demo, where adapters started serving)." };

const DASH: Record<string, string> = { pour: "", pick: "5 3", stack: "1.5 2.5" };
const FONT = { fontFamily: "var(--font-mono)" };

export default function LearningCurve() {
  const { st } = useConsole();
  const { collapsed } = usePanel();
  const [ref, { w: W, h: H }] = useSize<HTMLDivElement>();
  useTick(["episode:done", "adapter", "theme"], 300);
  const d = st.done, n = d.length;
  const present = (Object.keys(TASKS) as (keyof typeof TASKS)[]).filter((k) => d.some((e) => e.task === k));
  const roll = (arr: boolean[], win: number) => arr.map((_, i) => { const sl = arr.slice(Math.max(0, i - win + 1), i + 1); return sl.filter(Boolean).length / sl.length; });
  const fleet = roll(d.map((e) => e.outcome === "success"), 20);
  const now = n ? Math.round(fleet[n - 1] * 100) : 0;
  const first = Math.round(successRate(d.slice(0, 20)) * 100);

  let chart: React.ReactNode = null;
  if (!collapsed && W && H) {
    if (n < 5) chart = <p className="empty">The curve appears after five episodes.</p>;
    else {
      const P = { l: 30, r: 8, t: 8, b: 16 }, start = 4;
      const x = (i: number) => P.l + (i / Math.max(1, n - 1)) * (W - P.l - P.r);
      const y = (v: number) => P.t + (1 - v) * (H - P.t - P.b);
      const line = fleet.map((v, i) => (i < start ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean) as string[];
      chart = (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Fleet success rate went from ${Math.round(fleet[start] * 100)}% to ${now}% over ${n} episodes`}>
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === 0.5 ? "2 4" : undefined} />
              <text x={P.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--subtle)" style={FONT}>{v * 100}%</text>
            </g>
          ))}
          <path d={`M${x(start)},${y(0)} L${line.join(" L")} L${x(n - 1)},${y(0)} Z`} fill="var(--fg)" fillOpacity=".07" />
          {present.map((k) => {
            const idx: number[] = []; d.forEach((e, i) => e.task === k && idx.push(i));
            if (idx.length < 6) return null;
            const r = roll(idx.map((i) => d[i].outcome === "success"), 8);
            const pts = idx.map((i, j) => (j < 3 ? null : `${x(i).toFixed(1)},${y(r[j]).toFixed(1)}`)).filter(Boolean).join(" ");
            return <polyline key={k} points={pts} fill="none" stroke="var(--muted)" strokeWidth="1" strokeDasharray={DASH[k]} strokeOpacity=".75" />;
          })}
          <polyline points={line.join(" ")} fill="none" stroke="var(--fg)" strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx={x(n - 1)} cy={y(fleet[n - 1])} r="3" fill="var(--fg)" />
          {d.map((e, i) => (e.lessonWritten ? <line key={e.id} x1={x(i)} x2={x(i)} y1={y(0) - 6} y2={y(0)} stroke="var(--fg)" strokeWidth="1.1" /> : null))}
          {st.adapterMarks.map((m) => {
            const i = Math.min(Math.max(m.doneIdx, 0), n - 1);
            const flip = x(i) > W - P.r - 80;
            return (
              <g key={m.task}>
                <line x1={x(i)} x2={x(i)} y1={P.t} y2={y(0)} stroke="var(--ok)" strokeDasharray="2 3" />
                <text x={x(i) + (flip ? -3 : 3)} y={y(0) - 10} textAnchor={flip ? "end" : "start"} fontSize="9" fill="var(--ok)" style={FONT}>{m.task} adapter</text>
              </g>
            );
          })}
          <text x={P.l} y={H - 3} fontSize="9.5" fill="var(--subtle)" style={FONT}>ep 1</text>
          <text x={W - P.r} y={H - 3} textAnchor="end" fontSize="9.5" fill="var(--subtle)" style={FONT}>ep {n}</text>
        </svg>
      );
    }
  }

  return (
    <>
      <PanelSub>{n ? <><b>{now}%</b> now · {first}% at start</> : "waiting for episodes"}</PanelSub>
      <div className={s.wrap}>
        <div ref={ref} className={s.plot}>{chart}</div>
        <div className="legend">
          <span><svg viewBox="0 0 18 8"><path d="M1 4h16" stroke="var(--fg)" strokeWidth="2" /></svg>Fleet</span>
          {present.length > 1 && present.map((k) => [k, TASKS[k]] as const).map(([k, t]) => <span key={k}><svg viewBox="0 0 18 8"><path d="M1 4h16" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray={DASH[k]} /></svg>{t.name.split(" ")[0]}</span>)}
          <span><svg viewBox="0 0 18 8"><path d="M9 0v8" stroke="var(--fg)" strokeWidth="1.4" /></svg>Lesson</span>
        </div>
      </div>
    </>
  );
}
