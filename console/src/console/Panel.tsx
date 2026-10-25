"use client";

// The panel shell: collapsible header, a one-line summary slot and an actions slot the
// panel fills through <PanelSub> and <PanelActions>, and an error boundary so one broken
// panel can't take the tab down.

import { Component, createContext, useContext, useId, useState, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PANELS } from "@/panels";
import type { PanelEntry } from "@/tabs";

interface PanelApi { collapsed: boolean; expand: () => void; subEl: HTMLElement | null; actEl: HTMLElement | null }
const PanelCtx = createContext<PanelApi>({ collapsed: false, expand: () => {}, subEl: null, actEl: null });

/** Whether this panel is collapsed. Skip heavy work while it is. */
export const usePanel = () => useContext(PanelCtx);

/** The header's one-line summary. Stays visible while the panel is collapsed. */
export function PanelSub({ children }: { children: ReactNode }) {
  const { subEl } = usePanel();
  return subEl ? createPortal(children, subEl) : null;
}
/** Small controls on the right of the header. Hidden while collapsed. */
export function PanelActions({ children }: { children: ReactNode }) {
  const { actEl } = usePanel();
  return actEl ? createPortal(children, actEl) : null;
}

const KEY = "steward.panels.v2";
function readSaved(): Record<string, boolean> { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } }
function writeSaved(id: string, v: boolean) { try { const s = readSaved(); s[id] = v; localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ } }

class Boundary extends Component<{ id: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`[steward] panel ${this.props.id} crashed`, error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel-error">
        <b>{this.props.id}</b> stopped working: {this.state.error.message}. The rest of the console keeps running.{" "}
        <button className="btn sm" type="button" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}

const Chevron = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
);

export function Panel({ entry, tab }: { entry: PanelEntry; tab: string }) {
  const mod = PANELS[entry.id];
  const meta = mod?.meta ?? { title: entry.id };
  const grow = entry.grow ?? meta.grow ?? 1;
  const minH = entry.minHeight ?? meta.minHeight ?? 110;
  const saveKey = `${tab}/${entry.id}/${entry.title || ""}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => readSaved()[saveKey] ?? entry.collapsed ?? false);
  const [subEl, setSubEl] = useState<HTMLElement | null>(null);
  const [actEl, setActEl] = useState<HTMLElement | null>(null);
  const bodyId = useId();
  const toggle = (v: boolean) => { setCollapsed(v); writeSaved(saveKey, v); };
  const Body = mod?.default;
  const classes = ["panel", collapsed && "is-collapsed", meta.mobileHeight && "fixed-mobile"].filter(Boolean).join(" ");
  const style = {
    flex: collapsed ? "0 0 auto" : `${grow} 1 0px`,
    minHeight: collapsed ? undefined : minH,
    ...(meta.mobileHeight ? { ["--mobile-h" as string]: meta.mobileHeight } : {}),
  };

  return (
    <section className={classes} style={style} data-panel={entry.id} aria-label={entry.title || meta.title}>
      <header className="panel-head">
        <button className="panel-toggle" type="button" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => toggle(!collapsed)}>
          <Chevron />{entry.title || meta.title}
        </button>
        <span className="panel-sub" ref={setSubEl} />
        <span className="panel-actions" ref={setActEl} />
      </header>
      <div className="panel-body" id={bodyId} hidden={collapsed}>
        <PanelCtx.Provider value={{ collapsed, expand: () => toggle(false), subEl, actEl }}>
          <Boundary id={entry.id}>
            {Body ? <Body {...(entry.props || {})} /> : <div className="panel-error"><b>{entry.id}</b> isn&apos;t registered. Add it to src/panels/index.ts.</div>}
          </Boundary>
        </PanelCtx.Provider>
      </div>
    </section>
  );
}
