"use client";

// Five headline numbers for the whole fleet, under the top bar on every tab.

import { median } from "@/engine/format";
import { successRate } from "@/engine/timeline";
import { isSapling } from "@/engine/calls";
import { useConsole, useTick } from "./hooks";
import s from "./FleetSummary.module.css";

export function FleetSummary() {
  const { st } = useConsole();
  useTick(["episode:done", "lessons", "mubit", "robots"], 800);
  const d = st.done, last = d.slice(-50), first = d.slice(0, 50);
  const rl = successRate(last), delta = Math.round((rl - successRate(first)) * 100);
  const holds = d.reduce((a, e) => a + e.holds, 0), stops = d.filter((e) => e.outcome === "stopped").length;
  const active = st.lessons.filter((l) => !l.retired);
  const uses = active.reduce((a, l) => a + l.uses, 0), succ = active.reduce((a, l) => a + l.successes, 0);
  const verifies = st.calls.filter((c) => c.task === "verify");
  const vlat = verifies.slice(-20).map((c) => c.ms);
  const failedCalls = st.calls.filter((c) => c.error).length;
  const bySapling = verifies.filter((c) => isSapling(c.via)).length;

  return (
    <section className={s.band} aria-label="Fleet summary">
      <Stat label="Success · last 50" value={<>{Math.round(rl * 100)}<small>%</small></>} sub={<><b className={delta >= 0 ? s.up : s.down}>{delta >= 0 ? "+" : ""}{delta} pts</b> since the first 50</>} />
      <Stat label="Attempts" value={d.length} sub={`${st.robots.length} robot${st.robots.length === 1 ? "" : "s"} · ${st.takes.length} take${st.takes.length === 1 ? "" : "s"}`} />
      <Stat label="Fleet lessons" value={active.length} sub={uses ? `recalled ${uses}× · ${Math.round((succ / uses) * 100)}% then succeeded` : "none recalled yet"} />
      <Stat label="Holds · stops" value={<>{holds}<small> / {stops}</small></>} sub="safety holds / sent to an operator" />
      <Stat label="Verify p50" value={<>{median(vlat) ?? "—"}<small> ms</small></>} sub={`${verifies.length ? `${Math.round((bySapling / verifies.length) * 100)}% by Sapling` : "no checks yet"}${failedCalls ? ` · ${failedCalls} calls failed` : ""}`} />
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className={s.stat}>
      <span className="eyebrow">{label}</span>
      <span className={s.v}>{value}</span>
      <span className={s.s}>{sub}</span>
    </div>
  );
}
