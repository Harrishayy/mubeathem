"use client";

import { useEffect, useState } from "react";
import { useTick } from "@/console/hooks";
import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import s from "../ds.module.css";

export const meta: PanelMeta = { title: "Tokens", minHeight: 160, about: "Color tokens and the type scale, read live from the current theme." };

const TOKENS: [string, string][] = [["--bg", "Page"], ["--s1", "Panel"], ["--s2", "Nested, hover"], ["--s3", "Active, track"], ["--line", "Hairline"], ["--line-2", "Strong hairline"], ["--fg", "Primary text, marks"], ["--muted", "Secondary text"], ["--subtle", "Labels, timestamps"], ["--ok", "Succeeded, supported"], ["--fail", "Failed, violation"], ["--hold", "Holding, needs info"]];

export default function DsTokens() {
  const v = useTick(["theme"]);
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setVals(Object.fromEntries(TOKENS.map(([t]) => [t, cs.getPropertyValue(t).trim()])));
  }, [v]);
  return (
    <>
      <PanelSub>styles/tokens.css · dark first, light mirrored</PanelSub>
      <div className={s.body}>
        <div className={s.sw}>{TOKENS.map(([t, use]) => <div key={t}><i style={{ background: `var(${t})` }} /><span>{t}<small>{use} · {vals[t]}</small></span></div>)}</div>
        <div className={s.type}>
          <div><span className={s.label}>Stat 18 mono</span><span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>92%</span></div>
          <div><span className={s.label}>Body 12.5</span><span style={{ fontSize: 12.5 }}>Holding until the person leaves the 2 m zone.</span></div>
          <div><span className={s.label}>Data 11.5 mono</span><span className="mono" style={{ fontSize: 11.5 }}>tilt_speed 0.36 · pour_height_cm 6 cm</span></div>
          <div><span className={s.label}>Panel title</span><span className="eyebrow" style={{ color: "var(--muted)", letterSpacing: ".18em", fontWeight: 600 }}>Decision trace</span></div>
        </div>
      </div>
    </>
  );
}
