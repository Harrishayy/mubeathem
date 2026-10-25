"use client";

import { useRef } from "react";
import { useConsole, useFrame, useTick } from "@/console/hooks";
import { PanelActions, PanelSub, usePanel } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { Pill, Glyph } from "@/ui/status";
import { EpisodeView } from "@/ui/media";
import { clamp, fmtT } from "@/engine/format";
import { stateAt, poseAt, currentPhase, liveStatus, eventIndexAt, DECISION_KINDS } from "@/engine/timeline";
import { callFor, viaLabel } from "@/engine/calls";
import { isResting } from "@/engine/playback";
import { selectedEpisode } from "@/engine/state";
import { STATUS_LABEL } from "@/engine/text";
import s from "./replay-stage.module.css";

export const meta: PanelMeta = { title: "Replay", minHeight: 330, mobileHeight: "72vh", about: "The selected episode: its take video or practice-world scene, a timeline of every decision, and playback controls." };

const RATES = [0.25, 0.5, 1, 2];

export default function ReplayStage() {
  const { st, store, actions } = useConsole();
  const { collapsed } = usePanel();
  useTick(["select", "playback"]);
  useTick(["frame"], 400);
  const ep = selectedEpisode(st);
  const sel = st.selection, pb = st.playback;
  const r = ep ? st.byId[ep.robot] : null;

  const laneRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const tagTL = useRef<HTMLSpanElement>(null), tagTR = useRef<HTMLSpanElement>(null), tagBL = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);

  // per frame: playhead, time and overlay tags, without re-rendering
  useFrame(() => {
    if (!ep || collapsed) return;
    const t = clamp(pb.t, 0, ep.duration);
    const sa = stateAt(ep, t), ph = currentPhase(ep, t), { u } = poseAt(ep, t);
    if (headRef.current) headRef.current.style.left = `calc(12px + (100% - 24px) * ${(t / ep.duration).toFixed(4)})`;
    if (timeRef.current) timeRef.current.innerHTML = `<b>${t.toFixed(1)}</b> / ${ep.duration.toFixed(1)} s`;
    if (tagTL.current) tagTL.current.textContent = sa.kind === "hold" ? "holding · not safe yet" : ph ? `${ph}${sa.kind === "motion" ? ` · ${Math.round(u * 100)}%` : ""}` : "planning";
    if (tagTR.current) {
      const on = sa.kind === "decide" || isResting(store);
      tagTR.current.hidden = !on;
      if (on) {
        if (sa.kind === "decide") tagTR.current.textContent = `${sa.seg.task} via ${viaLabel(sa.seg.via)} · ${Math.round((sa.seg.t1 - sa.seg.t0) * 1000)} ms`;
        else {
          // Resting on a decision: name the call that made it, and how long it really took.
          const { now } = eventIndexAt(ep, t), ci = now >= 0 ? callFor(ep, now) : -1, c = ci >= 0 ? ep.events[ci] : null;
          tagTR.current.textContent = c ? `${c.task} via ${viaLabel(c.via)} · ${c.ms} ms${ep.world === "isaac" ? " · sim paused" : ""}` : now >= 0 ? ep.events[now].kind : "Decision";
        }
      }
    }
    if (tagBL.current) tagBL.current.textContent = ep.video ? `take ${ep.take} · attempt ${ep.attempt}${ep.video.prepared ? " · inset: head camera" : ""}` : `take ${ep.take} · attempt ${ep.attempt}${ep.world === "isaac" ? " · no video recorded" : ""}`;
    if (tlRef.current) { tlRef.current.setAttribute("aria-valuenow", t.toFixed(1)); tlRef.current.setAttribute("aria-valuetext", `${fmtT(t)} of ${fmtT(ep.duration)}`); }
  });

  if (!ep || !r) return <p className="empty">Pick a robot to replay.</p>;

  const phases = st.spec.phases, dur = ep.duration;
  const status = sel.live ? liveStatus(r) : ep.outcome;
  const idx = r.history.findIndex((e) => e.id === ep.id), at = idx < 0 ? r.history.length : idx;
  const prevFail = [...r.history.slice(0, at)].reverse().find((e) => e.outcome !== "success");
  const nextFail = idx < 0 ? undefined : r.history.slice(idx + 1).find((e) => e.outcome !== "success");
  const playing = pb.playing && !sel.live;
  const canLive = !!r.live;
  const fromX = (cx: number) => { const b = laneRef.current!.getBoundingClientRect(); return clamp((cx - b.left) / b.width, 0, 1) * dur; };

  return (
    <>
      <PanelSub><b>{r.name}</b> #{ep.n} <Pill status={status || "running"} /></PanelSub>
      <PanelActions>
        <select className="sel sm" aria-label="Episode" value={sel.live ? "live" : ep.id} onChange={(e) => actions.select(r.id, e.target.value)}>
          {canLive && <option value="live">Live · #{r.ep.n} running now</option>}
          {[...r.history].reverse().slice(0, 120).map((e) => <option key={e.id} value={e.id}>#{e.n} · {STATUS_LABEL[e.outcome]} · {e.take} attempt {e.attempt}</option>)}
        </select>
        <button className="btn sm icon" type="button" title="Previous failure" aria-label="Previous failure" disabled={!prevFail} onClick={() => prevFail && actions.select(r.id, prevFail.id)}><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8.5 3L4.5 7l4 4" /></svg></button>
        <button className="btn sm icon" type="button" title="Next failure" aria-label="Next failure" disabled={!nextFail} onClick={() => nextFail && actions.select(r.id, nextFail.id)}><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5.5 3l4 4-4 4" /></svg></button>
      </PanelActions>
      <div className={s.stage}>
        <div className={s.view}>
          <EpisodeView key={ep.id} ep={ep} label={`Replay of ${r.name}, episode ${ep.n}`} t={() => clamp(st.playback.t, 0, ep.duration)} />
          <span ref={tagTL} className={`vp-tag ${s.tl}`} />
          <span ref={tagTR} className={`vp-tag ${s.tr}`} hidden />
          <span ref={tagBL} className={`vp-tag ${s.bl}`} />
        </div>
        <div
          ref={tlRef} className={s.tl2} role="slider" tabIndex={0} aria-label="Replay position" aria-valuemin={0} aria-valuemax={Number(dur.toFixed(1))}
          onPointerDown={(e) => { if ((e.target as HTMLElement).closest("button")) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); dragging.current = true; actions.seek(fromX(e.clientX)); }}
          onPointerMove={(e) => { if (dragging.current) actions.seek(fromX(e.clientX)); }}
          onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { actions.seek(pb.t - (e.shiftKey ? 1 : 0.1)); e.preventDefault(); }
            else if (e.key === "ArrowRight") { actions.seek(pb.t + (e.shiftKey ? 1 : 0.1)); e.preventDefault(); }
            else if (e.key === "[") actions.jumpDecision(-1);
            else if (e.key === "]") actions.jumpDecision(1);
            else if (e.key === " ") { actions.togglePlay(); e.preventDefault(); }
          }}
        >
          <div className={s.marks}>
            {ep.events.map((e, i) => DECISION_KINDS.has(e.kind) ? (
              <button key={i} type="button" style={{ left: `${((e.at / dur) * 100).toFixed(2)}%` }} title={`${fmtT(e.at)} · ${e.kind}`} aria-label={`Jump to ${e.kind} at ${fmtT(e.at)}`} onClick={(ev) => { ev.stopPropagation(); actions.seek(e.at); }}>
                <Glyph kind={e.kind} e={e} />
              </button>
            ) : null)}
          </div>
          <div ref={laneRef} className={s.lane}>
            {ep.segs.map((g, i) => {
              const style = { left: `${((g.t0 / dur) * 100).toFixed(2)}%`, width: `${(((g.t1 - g.t0) / dur) * 100).toFixed(2)}%` };
              if (g.kind === "motion") return <span key={i} className={s.motion} style={style}>{phases[g.phase!]}</span>;
              if (g.kind === "hold") return <span key={i} className={s.hold} style={style}>hold</span>;
              return <span key={i} className={s.decide} style={style} title={`${g.task} via ${viaLabel(g.via)}`} />;
            })}
          </div>
          <div className={s.ticks}><span>0.0 s</span><span>{ep.video ? "video time · decisions sit between frames" : "wall-clock time · shaded = waiting on a model call"}</span><span>{fmtT(dur)}</span></div>
          <div ref={headRef} className={s.head} />
        </div>
        <div className={s.ctl}>
          <button className="btn primary icon" type="button" aria-label={playing ? "Pause" : "Play"} onClick={actions.togglePlay}>
            {playing ? <svg viewBox="0 0 14 14" fill="currentColor"><rect x="3" y="2.5" width="3" height="9" /><rect x="8" y="2.5" width="3" height="9" /></svg> : <svg viewBox="0 0 14 14" fill="currentColor"><path d="M3.5 2v10l8.5-5z" /></svg>}
          </button>
          <button className="btn icon" type="button" title="Previous decision ( [ )" aria-label="Previous decision" onClick={() => actions.jumpDecision(-1)}><svg viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2.5" width="1.6" height="9" /><path d="M12 2.5v9L4.8 7z" /></svg></button>
          <button className="btn icon" type="button" title="Next decision ( ] )" aria-label="Next decision" onClick={() => actions.jumpDecision(1)}><svg viewBox="0 0 14 14" fill="currentColor"><rect x="10.4" y="2.5" width="1.6" height="9" /><path d="M2 2.5v9L9.2 7z" /></svg></button>
          <span ref={timeRef} className={`${s.time} mono`} />
          <div className="seg sm" role="group" aria-label="Playback speed">
            {RATES.map((x) => <button key={x} type="button" aria-pressed={pb.rate === x} onClick={() => actions.setRate(x)}>{x}×</button>)}
          </div>
          <label className="check"><input type="checkbox" checked={pb.pauseAt} onChange={(e) => actions.setPauseAt(e.target.checked)} /> Pause at decisions</label>
          <span className="grow" />
          {canLive && (
            <button className={`btn sm${sel.live ? " primary" : ""}`} type="button" onClick={() => (sel.live ? actions.seek(pb.t) : actions.followLive())}>
              {sel.live ? <><span className="pip" />Following live</> : "Follow live"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
