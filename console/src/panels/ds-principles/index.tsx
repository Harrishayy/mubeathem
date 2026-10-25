"use client";

import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import s from "../ds.module.css";

export const meta: PanelMeta = { title: "Principles", minHeight: 140, about: "The rules the console's design follows." };

export default function DsPrinciples() {
  return (
    <>
      <PanelSub>Aura&apos;s instrument feel, with hue for outcomes</PanelSub>
      <ol className={s.list}>
        <li><b>Monotone chrome, colored outcomes.</b> Green, red and amber mark only states a robot reached: succeeded or supported, failed or violation, holding or unsure.</li>
        <li><b>Every state has a shape.</b> Pills carry an icon and timeline marks have a glyph per event kind, so nothing relies on color alone.</li>
        <li><b>Numbers are mono and tabular,</b> with the units the planner uses (cm, N, mm, °).</li>
        <li><b>One viewport per tab.</b> Panels share their column&apos;s height. Collapse what you don&apos;t need; its header keeps a one-line summary.</li>
        <li><b>Replay is the source of truth.</b> Every row, mark and answer links back to the moment something was decided.</li>
      </ol>
    </>
  );
}
