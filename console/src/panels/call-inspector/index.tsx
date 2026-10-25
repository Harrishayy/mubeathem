"use client";

import { useState } from "react";
import { useConsole, useTick } from "@/console/hooks";
import { PanelActions, PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Glyph, EventText, Verdict } from "@/ui/status";
import { SaplingBars } from "@/ui/sapling";
import { fmtClock, fmtP, SHORT } from "@/engine/format";
import { nameOf, selectedEpisode } from "@/engine/state";
import { eventIndexAt } from "@/engine/timeline";
import { callFor, decisionFor, isSapling, viaLabel } from "@/engine/calls";
import type { Episode, SEvent } from "@/engine/types";
import s from "./call-inspector.module.css";

export const meta: PanelMeta = { title: "Call inspector", minHeight: 200, about: "One model call in full: what Steward sent (with the fixed instructions and schema), what Mubit or Sapling returned, and the decision it became." };


/** The selected call, else the call behind the replay's current decision. */
function useCall(): { ep: Episode; idx: number; following: boolean } | null {
  const { st } = useConsole();
  const sel = st.callSel, ep = sel ? st.episodes[sel.epId] : null;
  if (ep && ep.events[sel!.idx]?.kind === "call") return { ep, idx: sel!.idx, following: false };
  const rep = selectedEpisode(st);
  if (!rep) return null;
  const { now, idx } = eventIndexAt(rep, st.playback.t);
  let ci = now >= 0 ? callFor(rep, now) : -1;
  if (ci < 0) for (let i = idx; i >= 0; i--) if (rep.events[i].kind === "call") { ci = i; break; }
  return ci >= 0 ? { ep: rep, idx: ci, following: true } : null;
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export default function CallInspector() {
  const { st, actions } = useConsole();
  useTick(["callsel", "select", "seek", "robots"]);
  useTick(["frame"], 500);
  const [view, setView] = useState<"exchange" | "raw">("exchange");
  const found = useCall();
  if (!found) return <><PanelSub>nothing selected</PanelSub><p className="empty">Pick a call in the decision trace or the calls table, or play a replay: this follows the call behind each decision.</p></>;
  const { ep, idx, following } = found;
  const e = ep.events[idx], r = st.byId[ep.robot];
  const di = decisionFor(ep, idx), decision = di >= 0 ? ep.events[di] : null;
  const manifest = ep.take ? st.manifests[ep.take] : undefined;
  const fixed = manifest?.tasks?.[e.task];
  const sapling = isSapling(e.via);
  const copy = async (v: unknown, what: string) => { try { await navigator.clipboard.writeText(pretty(v)); actions.toast(`Copied the ${what}.`); } catch { actions.toast("Copying isn't allowed here. Select the text instead."); } };

  return (
    <>
      <PanelSub><Glyph kind="call" /> <b>{e.task}</b> via {viaLabel(e.via)} · {e.ms} ms{following ? " · following the replay" : ""}</PanelSub>
      <PanelActions>
        <div className="seg sm" role="group" aria-label="View"><button type="button" aria-pressed={view === "exchange"} onClick={() => setView("exchange")}>Exchange</button><button type="button" aria-pressed={view === "raw"} onClick={() => setView("raw")}>Raw line</button></div>
      </PanelActions>
      <div className={s.wrap}>
        <dl className={s.facts}>
          <div><dt>Robot</dt><dd>{r?.name || nameOf(st, ep.robot)}</dd></div>
          <div><dt>{ep.take ? "Take" : "Episode"}</dt><dd>{ep.take ? `${ep.take} · attempt ${ep.attempt}` : `#${ep.n}`}</dd></div>
          <div><dt>At</dt><dd className="mono">{fmtClock(ep.start + e.at, true)} · {e.at.toFixed(2)} s in</dd></div>
          <div><dt>Latency</dt><dd className="mono">{e.ms} ms</dd></div>
          {e.request_id && <div><dt>Request</dt><dd className="mono">{e.request_id}</dd></div>}
          {e.model && <div><dt>Model</dt><dd className="mono">{e.model}</dd></div>}
          {e.usage && <div><dt>Tokens</dt><dd className="mono">{e.usage.prompt_tokens ?? "?"} in · {e.usage.completion_tokens ?? "?"} out</dd></div>}
        </dl>

        {view === "raw" ? <pre className={s.code}>{pretty(Object.fromEntries(Object.entries(e).filter(([k]) => k !== "at")))}</pre> : (
          <>
            {e.error && <div className={s.error}><b>The call failed.</b> {e.error} Steward fails closed: the robot {e.task === "verify" ? "stopped instead of acting" : "stopped"}.</div>}
            {!e.sent && !e.error && <p className={s.note}>This take was recorded before Steward logged call payloads; only the timing{e.request_id ? " and request id" : ""} survive.</p>}

            {e.sent && (
              <section className={s.block}>
                <h4>Sent <span>to {viaLabel(e.via)}</span><button className="btn sm ghost" type="button" onClick={() => copy(e.sent, "request")}>Copy</button></h4>
                {sapling ? (
                  <>
                    <Field name="Policy" text={e.sent.policy} />
                    <Field name="Evidence" text={e.sent.evidence} />
                    <Field name="Claim" text={e.sent.claim} />
                  </>
                ) : (
                  <>
                    {fixed ? (
                      <details className={s.fixed}><summary>System instructions · fixed for every {e.task} call</summary><pre className={s.code}>{fixed.instructions}</pre></details>
                    ) : <p className={s.note}>The system instructions are fixed per task; this take didn&apos;t log them.</p>}
                    <Field name="User message" text={e.sent.user} />
                    {fixed && <details className={s.fixed}><summary>Response format · json_schema “{e.task}”, strict</summary><pre className={s.code}>{pretty(fixed.schema)}</pre></details>}
                  </>
                )}
              </section>
            )}

            {e.got && (
              <section className={s.block}>
                <h4>Returned <span>{e.finish_reason ? `finish: ${e.finish_reason}` : ""}</span><button className="btn sm ghost" type="button" onClick={() => copy(e.got, "response")}>Copy</button></h4>
                {sapling ? <><SaplingBars got={e.got} /><pre className={s.code}>{pretty(e.got)}</pre></> : <Returned e={e} />}
              </section>
            )}

            {decision && (
              <section className={s.block}>
                <h4>Became</h4>
                <button type="button" className={s.became} onClick={() => actions.replay(ep.robot, ep.id, { t: decision.at, paused: true })}>
                  <Glyph kind={decision.kind} e={decision} /><span><b>{decision.kind}</b> <EventText e={decision} /></span><span className="subtle">{decision.at.toFixed(2)} s · replay</span>
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Field({ name, text }: { name: string; text?: string }) {
  if (!text) return null;
  return <div className={s.field}><div className="eyebrow">{name}</div><pre className={s.text}>{text}</pre></div>;
}

function Returned({ e }: { e: SEvent }) {
  const g = e.got;
  if (e.task === "plan") {
    const keys = Object.keys(g).filter((k) => typeof g[k] === "number");
    return (
      <>
        <div className={s.settings}>{keys.map((k) => <span key={k}><small>{SHORT[k] || k}</small><b className="mono">{fmtP(k, g[k])}</b></span>)}</div>
        {g.justification && <p className={s.why}>{g.justification}</p>}
        <pre className={s.code}>{pretty(g)}</pre>
      </>
    );
  }
  if (e.task === "verify") return <><p className={s.why}><Verdict label={g.label} status={g.status} /> {g.reason}</p><pre className={s.code}>{pretty(g)}</pre></>;
  if (e.task === "lesson") return <><p className={s.why}>{g.text}</p><div className="chips">{(g.applies_to || []).map((w: string) => <span key={w} className="chip">{w}</span>)}</div><pre className={s.code}>{pretty(g)}</pre></>;
  return <pre className={s.code}>{pretty(g)}</pre>;
}
