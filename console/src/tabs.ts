// THE LAYOUT. Each tab is one viewport; each panel is one line.
//
//   Remove a panel:   delete its line.
//   Add a panel:      create src/panels/<id>/index.tsx (copy src/panels/_template),
//                     register it in src/panels/index.ts, then add { id: "<id>" } here.
//   Move or reorder:  move the line within or between columns, or to another tab.
//   Add a tab:        add an entry to TABS; it gets its own route at /<id>.
//
// Per-panel options (all optional):
//   title       header text (defaults to the panel's meta.title)
//   grow        share of the column's height while expanded (default 1)
//   minHeight   smallest height in px while expanded
//   collapsed   start collapsed (each viewer's own toggles are remembered after that)
//   props       passed to the panel component, so one panel can serve several tabs

export interface PanelEntry { id: string; title?: string; grow?: number; minHeight?: number; collapsed?: boolean; props?: Record<string, unknown> }
export interface Column { id: string; label: string; width: string; panels: PanelEntry[] }
export interface TabDef { id: string; label: string; hint: string; columns: Column[] }

export const TABS: TabDef[] = [
  {
    id: "fleet", label: "Fleet", hint: "Every robot, live",
    columns: [
      { id: "robots", label: "Robots", width: "minmax(0, 1fr)", panels: [{ id: "robot-grid" }] },
      {
        id: "health", label: "Fleet health", width: "minmax(340px, 30%)",
        panels: [
          { id: "learning-curve", grow: 1.1, minHeight: 170 },
          { id: "attention", grow: 0.9 },
          { id: "activity", grow: 1.3 },
        ],
      },
    ],
  },
  {
    id: "replay", label: "Replay", hint: "One episode, decision by decision",
    columns: [
      // The video gets the whole column height; pick another robot from the Fleet tab.
      { id: "stage", label: "Replay", width: "minmax(0, 1fr)", panels: [{ id: "replay-stage", minHeight: 330 }] },
      {
        id: "assist", label: "Debrief", width: "minmax(340px, 30%)",
        panels: [
          { id: "decision-trace", grow: 1.4, minHeight: 180 },
          { id: "debrief", grow: 1.6, minHeight: 220 },
          { id: "call-inspector", title: "Call behind this decision", grow: 1, minHeight: 150 },
        ],
      },
    ],
  },
  {
    id: "failures", label: "Failures", hint: "What went wrong, and what not to do",
    columns: [
      { id: "failed", label: "Failures", width: "minmax(0, 1fr)", panels: [{ id: "failures" }] },
      { id: "dont", label: "What not to do", width: "minmax(360px, 40%)", panels: [{ id: "dont-list" }] },
    ],
  },
  {
    id: "lessons", label: "Lessons", hint: "What the fleet has learned",
    columns: [
      { id: "memory", label: "Lessons", width: "minmax(0, 1fr)", panels: [{ id: "lessons" }] },
      {
        id: "effect", label: "Effect", width: "minmax(340px, 34%)",
        panels: [
          { id: "lesson-impact", grow: 1.3 },
          { id: "activity", title: "Lesson activity", grow: 1, props: { kinds: ["lesson", "result"] } },
        ],
      },
    ],
  },
];

export const tabById = (id: string) => TABS.find((t) => t.id === id);
