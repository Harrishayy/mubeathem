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
      { id: "pick", label: "Robots", width: "minmax(270px, 20%)", panels: [{ id: "robot-list" }] },
      {
        id: "stage", label: "Replay", width: "minmax(0, 1fr)",
        panels: [
          { id: "replay-stage", grow: 3, minHeight: 330 },
          { id: "decision-trace", grow: 1.5 },
        ],
      },
      {
        id: "assist", label: "Debrief", width: "minmax(320px, 27%)",
        panels: [
          { id: "debrief", grow: 2.3, minHeight: 260 },
          { id: "call-inspector", title: "Call behind this decision", grow: 1.6, minHeight: 180 },
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
  {
    id: "calls", label: "Calls", hint: "Every Mubit and Sapling call, sent and returned",
    columns: [
      {
        id: "services", label: "Mubit and Sapling", width: "minmax(0, 1fr)",
        panels: [
          { id: "mubit-tasks", grow: 0.9, minHeight: 250 },
          { id: "sapling", grow: 1.1, minHeight: 170 },
          { id: "mubit-latency", grow: 1 },
        ],
      },
      { id: "list", label: "Calls", width: "minmax(380px, 33%)", panels: [{ id: "model-calls" }] },
      { id: "inspect", label: "Inspector", width: "minmax(360px, 31%)", panels: [{ id: "call-inspector" }] },
    ],
  },
  {
    id: "log", label: "Log", hint: "Every Steward event",
    columns: [
      { id: "events", label: "Events", width: "minmax(0, 1fr)", panels: [{ id: "event-log" }] },
      {
        id: "detail", label: "Detail", width: "minmax(340px, 32%)",
        panels: [
          { id: "event-detail", grow: 1.4 },
          { id: "takes", grow: 1 },
        ],
      },
    ],
  },
  {
    id: "services", label: "Services", hint: "Backend services, data sources and practice runs",
    columns: [
      { id: "backend", label: "Services", width: "minmax(0, 1fr)", panels: [{ id: "services" }] },
      {
        id: "run", label: "Run", width: "minmax(360px, 40%)",
        panels: [
          { id: "practice", grow: 1.1, minHeight: 220 },
          { id: "takes", grow: 1.2 },
        ],
      },
    ],
  },
  {
    id: "system", label: "System", hint: "Design system and layout map",
    columns: [
      {
        id: "foundations", label: "Foundations", width: "minmax(0, 1fr)",
        panels: [
          { id: "ds-principles", grow: 0.8 },
          { id: "ds-tokens", grow: 1.2 },
        ],
      },
      {
        id: "parts", label: "Parts", width: "minmax(0, 1fr)",
        panels: [
          { id: "ds-components", grow: 1 },
          { id: "ds-layout", grow: 1.2 },
        ],
      },
    ],
  },
];

export const tabById = (id: string) => TABS.find((t) => t.id === id);
