// Reading across episodes: what came before and after an attempt, what changed between
// two plans, and the patterns behind failures ("what not to do").

import { fmtP, median } from "./format";
import type { Episode, Range, Settings, State } from "./types";

/** The robot's next attempt in the same take. */
export function nextAttempt(st: State, ep: Episode): Episode | null {
  const r = st.byId[ep.robot]; if (!r) return null;
  const i = r.history.findIndex((e) => e.id === ep.id);
  const nx = i >= 0 ? r.history[i + 1] : undefined;
  if (!nx) return r.ep && r.ep.id !== ep.id && (ep.take == null || r.ep.take === ep.take) && r.ep.start > ep.start ? r.ep : null;
  return ep.take != null && nx.take !== ep.take ? null : nx;
}

export function prevAttempt(st: State, ep: Episode): Episode | null {
  const r = st.byId[ep.robot]; if (!r) return null;
  const i = r.history.findIndex((e) => e.id === ep.id);
  const pv = i > 0 ? r.history[i - 1] : null;
  return pv && (ep.take == null || pv.take === ep.take) ? pv : null;
}

export interface Change { k: string; from: number; to: number }
export function planDiff(a: Settings, b: Settings): Change[] {
  return Object.keys(a).filter((k) => a[k] != null && b[k] != null && a[k] !== b[k]).map((k) => ({ k, from: a[k], to: b[k] }));
}
export const fmtChange = (c: Change) => `${c.k} ${fmtP(c.k, c.from)} → ${fmtP(c.k, c.to)}`;

/** For each setting, the range failed plans used against the range successful ones used. */
export interface SettingSplit { k: string; failed: [number, number]; ok: [number, number]; failedMedian: number; okMedian: number; nFailed: number; nOk: number; separated: boolean; dir: "hi" | "lo" }

export function settingSplits(eps: Episode[], params: Record<string, Range>): SettingSplit[] {
  const failed = eps.filter((e) => e.outcome === "failed"), ok = eps.filter((e) => e.outcome === "success");
  if (!failed.length || !ok.length) return [];
  const out: SettingSplit[] = [];
  for (const [k, [lo, hi]] of Object.entries(params)) {
    const f = failed.map((e) => e.plan[k]).filter((v) => typeof v === "number"), s = ok.map((e) => e.plan[k]).filter((v) => typeof v === "number");
    if (!f.length || !s.length) continue;
    const fm = median(f)!, sm = median(s)!;
    const range = (v: number[]): [number, number] => [Math.min(...v), Math.max(...v)];
    const fr = range(f), sr = range(s);
    // "Separated": the medians sit far apart relative to the setting's range.
    out.push({ k, failed: fr, ok: sr, failedMedian: fm, okMedian: sm, nFailed: f.length, nOk: s.length, separated: Math.abs(fm - sm) >= 0.15 * (hi - lo), dir: fm > sm ? "hi" : "lo" });
  }
  return out.sort((a, b) => Number(b.separated) - Number(a.separated) || Math.abs(b.failedMedian - b.okMedian) - Math.abs(a.failedMedian - a.okMedian));
}
