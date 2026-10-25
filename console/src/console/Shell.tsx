"use client";

// Everything around the tabs: brand, tab navigation, live state, clock, fleet controls,
// the fleet summary band, and toasts. Present on every tab.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { TABS } from "@/tabs";
import { SOURCES } from "@/sources";
import { fmtClock } from "@/engine/format";
import { useConsole, useOn, useTick } from "./hooks";
import { FleetSummary } from "./FleetSummary";
import s from "./Shell.module.css";

function Clock() {
  const { st } = useConsole();
  useTick(["frame"], 500);
  return <span className={`${s.clock} mono`}>{fmtClock(st.simNow)} UTC</span>;
}

function Toaster() {
  const [t, setT] = useState<{ msg: string; label?: string; run?: () => void; id: number } | null>(null);
  useOn("toast", (p) => setT({ ...p, id: Date.now() }));
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 6000); return () => clearTimeout(id); }, [t]);
  return (
    <div className="toast" role="status" aria-live="polite" hidden={!t}>
      <span>{t?.msg}</span>
      {t?.label && <button type="button" onClick={() => { t.run?.(); setT(null); }}>{t.label}</button>}
    </div>
  );
}

function SourceStatus() {
  const { st } = useConsole();
  useTick(["source", "robots"], 500);
  const src = st.source, sim = src.caps.includes("sim");
  const running = st.robots.filter((r) => r.live).length;
  const text = sim ? (st.running ? "Simulated fleet · live" : "Simulated fleet · paused")
    : !src.connected ? "Runs · reconnecting" : src.live ? `Runs · live · ${running} robot${running === 1 ? "" : "s"} working` : "Runs · idle";
  return <span className={s.live} title={src.note || src.label}><span className={`pip${(sim ? st.running : src.live) ? "" : " off"}`} />{text}</span>;
}

export function Shell({ children }: { children: ReactNode }) {
  const { st, actions, sourceId, switchSource } = useConsole();
  const sim = st.source.caps.includes("sim");
  const router = useRouter();
  const path = usePathname();
  const active = path.split("/")[1] || "fleet";
  useTick(["fleet", "lessons", "robots"], 300);
  useOn("navigate", (tab: string) => router.push(`/${tab}`));

  // 1–9 switch tabs, unless you're typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [contenteditable]")) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < TABS.length) router.push(`/${TABS[i].id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const badge = (id: string) => {
    if (id === "lessons") return st.lessons.filter((l) => !l.retired).length;
    if (id === "fleet") return st.robots.filter((r) => !r.imported).length;
    if (id === "failures") return st.done.filter((e) => e.outcome === "failed" || e.outcome === "stopped").length || null;
    return null;
  };

  return (
    <div className="console">
      <header className={s.top}>
        <div className={s.brand}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M3 17h6M6 17V12" /><circle cx="6" cy="11" r="1.6" /><path d="M7.3 10l4.8-4" /><circle cx="13.2" cy="5" r="1.4" /><path d="M14.4 5.8l2.4 3.4M15.2 9.8l1.6-.6" /></svg>
          <span className={s.word}>STEWARD</span>
        </div>
        <nav className={s.tabs} aria-label="Tabs">
          {TABS.map((t, i) => (
            <Link key={t.id} href={`/${t.id}`} className={s.tab} aria-current={active === t.id ? "page" : undefined} title={`${t.hint} (${i + 1})`}>
              {t.label}{badge(t.id) != null && <span className={s.badge}>{badge(t.id)}</span>}
            </Link>
          ))}
        </nav>
        <span className="grow" />
        <SourceStatus />
        <Clock />
        {sim && <button className="btn sm" type="button" onClick={actions.toggleRun}>{st.running ? "Pause fleet" : "Run fleet"}</button>}
        {sim && (
          <div className="seg sm" role="group" aria-label="Fleet speed">
            {[1, 2, 4].map((n) => <button key={n} type="button" aria-pressed={st.speed === n} onClick={() => actions.setSpeed(n)}>{n}×</button>)}
          </div>
        )}
        <div className="seg sm" role="group" aria-label="Data source">
          {SOURCES.map((src) => <button key={src.id} type="button" aria-pressed={src.id === sourceId} title={src.about} onClick={() => switchSource(src.id)}>{src.short}</button>)}
        </div>
      </header>
      <FleetSummary />
      {children}
      <Toaster />
    </div>
  );
}
