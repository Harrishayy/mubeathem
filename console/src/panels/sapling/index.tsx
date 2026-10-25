"use client";

import { useEffect, useState } from "react";
import { useConsole, useTick } from "@/console/hooks";
import { PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Verdict } from "@/ui/status";
import { SaplingBars, SAPLING_LABELS } from "@/ui/sapling";
import { median } from "@/engine/format";
import { isSapling, topProbability } from "@/engine/calls";
import { saplingStatus, checkClaim, type SaplingAnswer } from "@/services/sapling/client";
import s from "./sapling.module.css";

export const meta: PanelMeta = { title: "Safety checks", minHeight: 170, about: "Every safety verdict: Sapling's labels and calibrated confidence, unsure answers, holds and stops, and whether Sapling is up. Send it one check by hand." };

export default function Sapling() {
  const { st } = useConsole();
  const { collapsed } = usePanel();
  useTick(["robots", "episode:done", "mubit"], 1200);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof saplingStatus>> | null>(null);
  useEffect(() => {
    if (st.source.id === "demo") return;
    let alive = true;
    const poll = () => saplingStatus().then((h) => alive && setHealth(h)).catch(() => alive && setHealth(null));
    poll(); const id = setInterval(poll, 15000);
    return () => { alive = false; clearInterval(id); };
  }, [st.source.id]);

  const checks = Object.values(st.episodes).flatMap((ep) => ep.events.filter((e) => e.kind === "safety"));
  const by: Record<string, number> = {}, from: Record<string, number> = {};
  let unsure = 0;
  for (const e of checks) { if (e.status === "unsure") unsure++; else by[e.label] = (by[e.label] || 0) + 1; from[e.by || "stand-in"] = (from[e.by || "stand-in"] || 0) + 1; }
  const sap = st.calls.filter((c) => isSapling(c.via));
  const tops = sap.map((c) => topProbability(st.episodes[c.epId].events[c.idx])).filter((v): v is number => v != null);
  const bins = [0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1.0001].map((hi, i, a) => ({ lo: i ? a[i - 1] : 0, hi, n: 0 }));
  for (const v of tops) { const b = bins.find((x) => v >= x.lo && v < x.hi); if (b) b.n++; }
  const maxBin = Math.max(1, ...bins.map((b) => b.n));
  const holds = st.done.reduce((a, e) => a + e.holds, 0), stops = st.done.filter((e) => e.outcome === "stopped").length;
  const total = checks.length || 1;

  return (
    <>
      <PanelSub><b>{checks.length.toLocaleString()}</b> checks · {unsure} unsure · {holds} holds · {stops} stops{health ? ` · Sapling ${health.up ? "up" : health.configured ? "down" : "not configured"}` : ""}</PanelSub>
      {!collapsed && (
        <div className={s.wrap}>
          <div className={s.dist}>
            {[...SAPLING_LABELS, "unsure"].map((l) => {
              const n = l === "unsure" ? unsure : by[l] || 0;
              return (
                <div key={l} className={s.row}>
                  <span>{l === "unsure" ? <span className="verdict v-unsure">Unsure</span> : <Verdict label={l} />}</span>
                  <span className={s.track}><i style={{ width: `${(n / total) * 100}%` }} className={l === "supported" ? s.ok : l === "violation" ? s.bad : s.mid} /></span>
                  <span className="mono">{n}</span>
                </div>
              );
            })}
          </div>
          <div className={s.meta}>
            <span>Checked by {Object.entries(from).map(([k, n]) => `${k} ${n}`).join(" · ") || "nobody yet"}</span>
            {sap.length > 0 && <span>Sapling p50 <b className="mono">{median(sap.map((c) => c.ms))} ms</b></span>}
          </div>
          {tops.length > 0 && (
            <div>
              <div className="eyebrow">Sapling&apos;s confidence in the label it gave · {tops.length} checks</div>
              <div className={s.hist} role="img" aria-label="Histogram of Sapling's top-label probability">
                {bins.map((b) => <span key={b.lo} title={`${Math.round(b.lo * 100)}–${Math.min(100, Math.round(b.hi * 100))}%: ${b.n}`}><i style={{ height: `${(b.n / maxBin) * 100}%` }} /><small>{Math.round(b.lo * 100)}</small></span>)}
              </div>
            </div>
          )}
          {st.source.id !== "demo" && <Check configured={!!health?.configured} up={!!health?.up} url={health?.url || null} />}
        </div>
      )}
    </>
  );
}

/** Send Sapling one policy / evidence / claim and see its answer. Prefilled from the latest check. */
function Check({ configured, up, url }: { configured: boolean; up: boolean; url: string | null }) {
  const { st } = useConsole();
  const last = [...st.calls].reverse().find((c) => isSapling(c.via) && st.episodes[c.epId]?.events[c.idx]?.sent);
  const sent = last ? st.episodes[last.epId].events[last.idx].sent : null;
  const [f, setF] = useState<{ policy: string; evidence: string; claim: string } | null>(null);
  const [res, setRes] = useState<SaplingAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = f || { policy: sent?.policy || "", evidence: sent?.evidence || "", claim: sent?.claim || "It is safe to run the next phase of this plan now." };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLTextAreaElement>) => setF({ ...form, [k]: e.target.value });
  return (
    <details className={s.check}>
      <summary>Send Sapling a check by hand{configured ? "" : " · needs SAPLING_URL"}</summary>
      {!configured ? <p className="subtle">Set SAPLING_URL in the repo&apos;s .env (for example an SSH tunnel to sapling/serve.py on the DGX) to send checks.</p> : (
        <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { setRes(await checkClaim(form)); } catch (x) { setErr((x as Error).message); } setBusy(false); }}>
          <label>Policy<textarea rows={3} value={form.policy} onChange={set("policy")} /></label>
          <label>Evidence<textarea rows={4} value={form.evidence} onChange={set("evidence")} /></label>
          <label>Claim<textarea rows={1} value={form.claim} onChange={set("claim")} /></label>
          <div className={s.acts}><button className="btn sm primary" type="submit" disabled={busy || !up}>{busy ? "Checking…" : "Check"}</button><span className="subtle">{up ? `Sapling at ${url}` : `Sapling isn't answering at ${url}`}</span></div>
          {err && <p className={s.err}>{err}</p>}
          {res && <div className={s.res}><SaplingBars got={res} /><span className="subtle mono">{res.ms} ms</span></div>}
        </form>
      )}
    </details>
  );
}
