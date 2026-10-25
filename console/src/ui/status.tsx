// The status vocabulary: pills, verdicts, event glyphs and one-line event text.
// Use these instead of hand-writing status markup.

import { STATUS_LABEL, VERDICT, eventText } from "@/engine/text";
import type { SEvent, Status } from "@/engine/types";

const ICON: Record<string, React.ReactNode> = {
  running: <svg viewBox="0 0 10 10"><path d="M2.5 1.5v7l6-3.5z" fill="currentColor" /></svg>,
  deciding: <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 1a4 4 0 1 1-4 4" /></svg>,
  holding: <svg viewBox="0 0 10 10"><rect x="2" y="1.5" width="2.2" height="7" fill="currentColor" /><rect x="5.8" y="1.5" width="2.2" height="7" fill="currentColor" /></svg>,
  success: <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1.8 5.3l2.2 2.2 4.3-4.8" /></svg>,
  failed: <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2.2 2.2l5.6 5.6M7.8 2.2l-5.6 5.6" /></svg>,
  stopped: <svg viewBox="0 0 10 10"><rect x="1.8" y="1.8" width="6.4" height="6.4" fill="currentColor" /></svg>,
  imported: <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 1.5v5M2.8 4.5L5 6.7l2.2-2.2M1.5 8.5h7" /></svg>,
};

export function Pill({ status }: { status: Status | string }) {
  const label = STATUS_LABEL[status] || status;
  return <span className={`pill st-${status}`} title={label}>{ICON[status]}<span className="pill-label">{label}</span></span>;
}

export function Verdict({ label, status }: { label: string; status?: string }) {
  if (status === "unsure") return <span className="verdict v-unsure" title={label}>Unsure · {VERDICT[label] || label}</span>;
  return <span className={`verdict v-${label}`}>{VERDICT[label] || label}</span>;
}

/** One glyph per event kind; color only where the event is an outcome. */
export function Glyph({ kind, e }: { kind: string; e?: Partial<SEvent> | null }) {
  const svg = (col: string, inner: React.ReactNode, fill = true) => (
    <svg className="glyph" viewBox="0 0 12 12" style={{ color: col }} fill={fill ? "currentColor" : "none"} aria-hidden="true">{inner}</svg>
  );
  switch (kind) {
    case "plan": return svg("var(--fg)", <path d="M6 1l5 5-5 5-5-5z" />);
    case "safety": {
      const col = e?.label === "supported" && e?.status === "decided" ? "var(--ok)" : e?.label === "violation" ? "var(--fail)" : "var(--hold)";
      return svg(col, <circle cx="6" cy="6" r="4.2" />);
    }
    case "hold": return svg("var(--hold)", <><rect x="2" y="2" width="3" height="8" /><rect x="7" y="2" width="3" height="8" /></>);
    case "escalate": return svg("var(--fail)", <path d="M6 1.2l5 9.3H1z" />);
    case "result": return svg(e?.success ? "var(--ok)" : "var(--fail)", <rect x="2" y="2" width="8" height="8" rx="1" />);
    case "lesson": return svg("var(--fg)", <path d="M6 1l1.4 3.6L11 6l-3.6 1.4L6 11 4.6 7.4 1 6l3.6-1.4z" />);
    case "outcome": return svg(e?.outcome === "success" ? "var(--ok)" : "var(--fail)", <path d="M2 2h8v8H2z" stroke="currentColor" strokeWidth="1.6" />, false);
    case "call": return svg("var(--muted)", <circle cx="6" cy="6" r="1.8" />);
    case "phase": return svg("var(--muted)", <rect x="5.2" y="1" width="1.6" height="10" />);
    case "lessons": return svg("var(--muted)", <path d="M2 3h8M2 6h8M2 9h5" stroke="currentColor" strokeWidth="1.4" />, false);
    default: return svg("var(--muted)", <path d="M3 2l6 4-6 4z" />);
  }
}

/** One line describing an event, with the verdict badge for safety checks. */
export function EventText({ e }: { e: SEvent }) {
  if (e.kind === "safety") return <><Verdict label={e.label} status={e.status} /> {e.reason}</>;
  return <>{eventText(e)}</>;
}
