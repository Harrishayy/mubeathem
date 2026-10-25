"use client";

import { PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { TABS } from "@/tabs";
import { PANELS } from "@/panels";
import s from "../ds.module.css";

export const meta: PanelMeta = { title: "Layout map", minHeight: 160, about: "Every tab, column and panel, read live from src/tabs.ts." };

export default function DsLayout() {
  const rows = TABS.flatMap((t) => t.columns.flatMap((c) => c.panels.map((p) => ({ tab: t.label, col: c.label, p }))));
  return (
    <>
      <PanelSub><b>{TABS.length}</b> tabs · <b>{rows.length}</b> panels · <b>{Object.keys(PANELS).length}</b> registered</PanelSub>
      <div className={s.body}>
        <p className="muted" style={{ fontSize: 12.5 }}>Each panel is a folder in <span className={s.code}>src/panels/</span>. To add one, copy <span className={s.code}>_template</span>, register it in <span className={s.code}>src/panels/index.ts</span>, and add its line to a tab in <span className={s.code}>src/tabs.ts</span>. To remove one, delete its line.</p>
      </div>
      <table className="tbl sticky">
        <thead><tr><th>Tab</th><th>Column</th><th>Panel</th><th>Folder</th><th>Grow</th><th>Starts</th></tr></thead>
        <tbody>
          {rows.map(({ tab, col, p }, i) => (
            <tr key={i} title={PANELS[p.id]?.meta.about}>
              <td className="n">{tab}</td><td className="n">{col}</td><td>{p.title || PANELS[p.id]?.meta.title || p.id}</td>
              <td className="n">src/panels/{p.id}</td><td className="n">{p.grow ?? 1}</td><td className="n">{p.collapsed ? "collapsed" : "open"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
