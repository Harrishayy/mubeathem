"use client";

import { useConsole, useSize, useTick } from "@/console/hooks";
import { PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { median } from "@/engine/format";
import s from "./mubit-latency.module.css";

export const meta: PanelMeta = { title: "Latency", minHeight: 160, about: "Each task's latency over its last 80 calls, with the point its adapter took over." };

export default function MubitLatency() {
  const { st } = useConsole();
  const { collapsed } = usePanel();
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  useTick(["mubit"], 1000);
  const entries = Object.entries(st.mubit);
  const rowH = Math.max(50, Math.floor((h - 8) / entries.length) - 8);
  const all = entries.flatMap(([, m]) => m.lat.map((x) => x.ms));
  const max = Math.max(200, ...all) * 1.08;
  const v = st.mubit.verify.lat, firstServe = v.findIndex((x) => x.serving);
  const before = firstServe > 0 ? median(v.slice(0, firstServe).map((x) => x.ms)) : null, after = firstServe > 0 ? median(v.slice(firstServe).map((x) => x.ms)) : null;
  return (
    <>
      <PanelSub>{before && after ? <>verify <b>{before} → {after} ms</b> with its adapter</> : "adapters cut latency once they serve"}</PanelSub>
      <div ref={ref} className={s.wrap}>
        {!collapsed && w > 0 && entries.map(([k, m]) => {
          const W = w - 120, H = rowH, lat = m.lat;
          const x = (i: number) => (lat.length > 1 ? (i / (lat.length - 1)) * W : 0), y = (ms: number) => H - 4 - (ms / max) * (H - 10);
          const pts = lat.map((l, i) => `${x(i).toFixed(1)},${y(l.ms).toFixed(1)}`).join(" ");
          const sw = lat.findIndex((l) => l.serving);
          return (
            <div key={k} className={s.row} style={{ height: H }}>
              <div className={s.lab}><b>{k}</b><span>p50 {median(lat.slice(-20).map((l) => l.ms)) ?? "—"} ms</span></div>
              <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${k} latency over the last ${lat.length} calls`}>
                <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" />
                {lat.length > 1 && <><path d={`M0,${y(0)} L${pts} L${W},${y(0)} Z`} fill="var(--fg)" fillOpacity=".07" /><polyline points={pts} fill="none" stroke="var(--fg)" strokeWidth="1.4" /></>}
                {sw > 0 && <><line x1={x(sw)} x2={x(sw)} y1="0" y2={H} stroke="var(--ok)" strokeDasharray="2 3" /><text x={x(sw) + 4} y="10" fontSize="9.5" fill="var(--ok)" style={{ fontFamily: "var(--font-mono)" }}>adapter</text></>}
              </svg>
            </div>
          );
        })}
      </div>
    </>
  );
}
