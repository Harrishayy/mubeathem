"use client";

import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Pill, Verdict, Glyph } from "@/ui/status";
import s from "../ds.module.css";

export const meta: PanelMeta = { title: "Components", minHeight: 160, about: "The shared status vocabulary and controls in src/ui." };

const GLYPHS: [string, Record<string, unknown> | null, string?][] = [["plan", null], ["safety", { label: "supported", status: "decided" }, "supported"], ["safety", { label: "violation", status: "decided" }, "violation"], ["hold", null], ["escalate", null], ["result", { success: true }, "ok"], ["result", { success: false }, "fail"], ["lesson", null], ["call", null], ["adapter", null]];

export default function DsComponents() {
  return (
    <>
      <PanelSub>src/ui · status.tsx, controls.tsx, charts.tsx</PanelSub>
      <div className={s.body}>
        <span className={s.label}>Robot status · &lt;Pill&gt;</span>
        <div className={s.row}>{["deciding", "running", "holding", "success", "failed", "stopped", "queued", "imported"].map((x) => <Pill key={x} status={x} />)}</div>
        <span className={s.label}>Verifier verdicts · &lt;Verdict&gt;</span>
        <div className={s.row}><Verdict label="supported" status="decided" /><Verdict label="violation" status="decided" /><Verdict label="insufficient_information" status="decided" /><Verdict label="inconsistent_context" status="decided" /><Verdict label="supported" status="unsure" /></div>
        <span className={s.label}>Event glyphs · &lt;Glyph&gt;</span>
        <div className={s.glyphs}>{GLYPHS.map(([k, e, l], i) => <span key={i}><Glyph kind={k} e={e} />{k}{l ? ` · ${l}` : ""}</span>)}</div>
        <span className={s.label}>Controls</span>
        <div className={s.row}>
          <button className="btn sm primary" type="button">Add to fleet lessons</button><button className="btn sm" type="button">Re-run with this fix</button><button className="btn sm ghost" type="button">Dismiss</button>
          <div className="seg sm" role="group" aria-label="Example"><button type="button" aria-pressed="true">1×</button><button type="button" aria-pressed="false">2×</button></div>
          <span className="chip">loose</span><span className="chip solid">lesson-3 · from GR1-01</span>
        </div>
        <span className={s.label}>Episode strip · &lt;EpisodeStrip&gt;</span>
        <div className="estrip">{"ffsfsfssxssssfsss".split("").map((c, i) => <span key={i} className={`eq ${c === "s" ? "success" : c === "f" ? "failed" : "stopped"}`} />)}<span className="eq live" /></div>
      </div>
    </>
  );
}
