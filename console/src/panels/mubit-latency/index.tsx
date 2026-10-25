"use client";

import { useConsole, useSize, useTick } from "@/console/hooks";
import { PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { median } from "@/engine/format";
import s from "./mubit-latency.module.css";

export const meta: PanelMeta = { title: "Latency", minHeight: 160, about: "Each Mubit task's latency over its last 80 successful calls, as Steward timed them." };

export default function MubitLatency() {
  const { st } = useConsole();
  const { collapsed } = usePanel();
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  useTick(["mubit"], 1000);
  const entries = Object.entries(st.mubit);
  const rowH = Math.max(50, Math.floor((h - 8) / Math.max(1, entries.length)) - 8);
  const all = entries.flatMap(([, m]) => m.lat);
  const max = Math.max(1, ...all) * 1.08;
  const p50 = median(all);
  return (
    <>
      <PanelSub>{p50 != null ? <>p50 <b>{p50} ms</b> across {all.length} calls</> : "no Mubit calls yet"}</PanelSub>
      <div ref={ref} className={s.wrap}>
        {!collapsed && w > 0 && entries.map(([k, m]) => {
          const W = w - 120, H = rowH, lat = m.lat;
          const x = (i: number) => (lat.length > 1 ? (i / (lat.length - 1)) * W : 0), y = (ms: number) => H - 4 - (ms / max) * (H - 10);
          const pts = lat.map((ms, i) => `${x(i).toFixed(1)},${y(ms).toFixed(1)}`).join(" ");
          return (
            <div key={k} className={s.row} style={{ height: H }}>
              <div className={s.lab}><b>{k}</b><span>p50 {median(lat.slice(-20)) ?? "—"} ms</span></div>
              <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${k} latency over the last ${lat.length} calls`}>
                <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" />
                {lat.length > 1 && <><path d={`M0,${y(0)} L${pts} L${W},${y(0)} Z`} fill="var(--fg)" fillOpacity=".07" /><polyline points={pts} fill="none" stroke="var(--fg)" strokeWidth="1.4" /></>}
              </svg>
            </div>
          );
        })}
      </div>
    </>
  );
}
