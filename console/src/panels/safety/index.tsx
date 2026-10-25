"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PanelActions, PanelSub } from "@/console/Panel";
import type { PanelMeta } from "@/console/types";
import { getSafety, getSafetyReport, safetyReportUrl, safetyVideoUrl } from "@/services/safety/client";
import { replayClearance, replayFrame, type ReplayFrame } from "@/services/safety/playback";
import type { SafetyCase, SafetyMetrics, SafetyReport, SafetyResult, SafetyStep } from "@/services/safety/types";
import s from "./safety.module.css";

export const meta: PanelMeta = { title: "Safety lab", minHeight: 400, about: "Matched adversarial simulations, with recorded model evidence." };
const number = (n: number, digits = 0) => n.toLocaleString(undefined, { maximumFractionDigits: digits });
const label = (v: string) => v.replaceAll("_", " ");
const formatJson = (v: unknown) => JSON.stringify(v, null, 2);
/** A model's short name from its recorded id: "openvla/openvla-7b" → "openvla-7b". */
const modelName = (id: string) => id.split("/").pop() || id;
/** Reports written before steward/security.py recorded a task are its pour comparison. */
const taskLabel = (task?: string) => (task || "pour-adversarial").replace(/[-_]/g, " ");
/** A plan setting's allowed range from the report's manifest, when the report recorded one. */
const rangeOf = (report: SafetyReport, key: string) => { const r = report.ranges?.[key]; return r ? ` · ${r[0]}–${r[1]}` : ""; };

function EvidenceDisclosure({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  return collapsed ? <details className={s.singleEvidence}><summary>Inspect the policy, geometry & model evidence <span>↓</span></summary>{children}</details> : <>{children}</>;
}

function Shield() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m8 12 3 3 5-6" /></svg>;
}

function Metric({ title, value, note, tone }: { title: string; value: string; note: string; tone?: "good" | "bad" | "neutral" }) {
  return <div className={s.metric}><span>{title}</span><strong className={tone ? s[tone] : ""}>{value}</strong><small>{note}</small></div>;
}

function ProposalCounts({ report }: { report: SafetyReport }) {
  const summary = report.summary;
  if (summary.unsafe_proposals === undefined || summary.unsafe_proposals_allowed === undefined || summary.safe_proposals === undefined || summary.safe_proposals_allowed === undefined) return null;
  return <p className={s.proposalCounts}>Raw verifier approvals per proposal: unsafe <b className={summary.unsafe_proposals_allowed ? s.bad : ""}>{summary.unsafe_proposals_allowed}/{summary.unsafe_proposals}</b> · safe <b>{summary.safe_proposals_allowed}/{summary.safe_proposals}</b>. These counts describe model decisions, not executed actions.</p>;
}

function Probabilities({ step }: { step: SafetyStep }) {
  const got = step.call.got || {};
  const probs = got.probabilities && typeof got.probabilities === "object" ? got.probabilities as Record<string, unknown> : {};
  const entries = Object.entries(probs).filter((p): p is [string, number] => typeof p[1] === "number" && Number.isFinite(p[1]) && p[1] >= 0 && p[1] <= 1);
  const prediction = Array.isArray(got.prediction_set) ? got.prediction_set.filter(v => typeof v === "string") : [];
  return <div className={s.model}>
    <div className={s.modelHeader}><h3>What Sapling actually returned</h3><span className={s.kicker}>{number(step.call.ms)} ms</span></div>
    <dl className={s.verdicts}>
      <div><dt>Model top label</dt><dd>{typeof got.raw_label === "string" ? label(got.raw_label) : "Not recorded"}</dd></div>
      <div><dt>Calibrated status</dt><dd>{typeof got.status === "string" ? label(got.status) : "Not recorded"}</dd></div>
      <div><dt>Controller verdict</dt><dd className={step.decision.allow ? s.good : s.bad}>{label(step.decision.label)} · {step.decision.status}</dd></div>
    </dl>
    {entries.length > 0 ? <div className={s.probabilities} aria-label="Recorded model probabilities">
      {entries.map(([name, value]) => <div key={name} className={s.probability}>
        <span>{label(name)}{prediction.includes(name) && <i title="In calibrated prediction set"> ◇</i>}</span>
        <div className={s.track}><i style={{ width: `${value * 100}%` }} /></div><b>{(value * 100).toFixed(1)}%</b>
      </div>)}
    </div> : <p className={s.note}>No probabilities were recorded for this call.</p>}
    {prediction.length > 0 && <p className={s.note}>◇ Calibrated prediction set: {prediction.map(label).join(", ")}.</p>}
    <p className={s.note}>Top label, calibrated confidence, and the controller&apos;s allow/block action are separate evidence. An uncertain calibrated result is not a confident safety guarantee.</p>
    {step.call.error && <p className={s.error}>Call error: {step.call.error}</p>}
  </div>;
}

function CommandFlow({ scenario, variant, frame, playing, source }: { scenario: SafetyCase; variant: "baseline" | "protected"; frame: ReplayFrame; playing: boolean; source: string }) {
  const step = scenario.steps[frame.stepIndex];
  if (!step) return null;
  if (frame.pending) return <div className={`${s.commandFlow} ${s.flowPending}`} role="img" aria-label="Recorded initial hold: awaiting first proposal"><div className={s.flowCaption}><span>Action 1/{scenario.steps.length}</span><b>PENDING</b></div><div className={s.flowPath}><span className={s.flowNode}>{source}</span><i className={s.flowArrow} /><span className={`${s.flowNode} ${s.flowGate}`}><small>First proposal</small>AWAITING</span><i className={s.flowArrow} /><span className={s.flowNode}>ROBOT HELD</span></div><strong>Awaiting first proposal</strong></div>;
  const protectedMode = variant === "protected";
  const executed = scenario[variant].steps?.find(s => s.step === frame.stepIndex)?.execute ?? (protectedMode ? step.execute : undefined);
  const rejected = protectedMode && !step.decision.allow;
  const raw = typeof step.call.got?.raw_label === "string" ? step.call.got.raw_label : "not recorded";
  const gate = !protectedMode ? executed === false ? "HOLD" : executed === true ? "EXECUTE" : "NOT RECORDED" : step.decision.source === "fail-closed" ? "ERROR" : rejected ? "REJECTED" : executed === false ? "STOP LATCHED" : "APPROVED";
  const status = executed === false ? protectedMode ? "Command blocked · robot held" : "Recorded hold · robot held" : executed === true ? "Command executed" : "Execution not recorded";
  return <div className={`${s.commandFlow} ${executed ? s.flowExecute : s.flowHeld}`} role="img" aria-label={`Recorded action ${frame.stepIndex + 1} of ${scenario.steps.length}: ${protectedMode ? `Sapling raw label ${raw}; ` : ""}${status}`}>
    <div className={s.flowCaption}><span>Action {frame.stepIndex + 1}/{scenario.steps.length}</span><b>{protectedMode ? label(raw).toUpperCase() : "UNGATED"}</b></div>
    <div className={s.flowPath}><span className={s.flowNode}>{source}</span><i className={s.flowArrow}><em style={{ left: `${frame.progress * 100}%`, opacity: playing && frame.moving ? 1 : .35 }} /></i><span className={`${s.flowNode} ${s.flowGate}`}><small>{protectedMode ? "Sapling" : "Direct command"}</small>{gate}</span><i className={`${s.flowArrow} ${executed === false ? s.flowStopped : ""}`}>{executed === false ? "×" : <em style={{ left: `${frame.progress * 100}%`, opacity: playing && frame.moving ? 1 : .35 }} />}</i><span className={s.flowNode}>{executed === false ? "ROBOT HELD" : executed === true ? "ROBOT MOVES" : "ROBOT"}</span></div>
    <strong>{protectedMode && step.decision.source === "fail-closed" ? "VERIFIER ERROR — command blocked" : protectedMode && rejected ? "REJECTED — command blocked" : status}</strong>
  </div>;
}

function Recording({ report, scenario, variant, videoRef, onTime, onEnded, onError, onEnlarge, frame, playing }: {
  report: SafetyReport; scenario: SafetyCase; variant: "baseline" | "protected";
  videoRef: React.RefObject<HTMLVideoElement | null>; onTime?: () => void; onEnded: () => void; onError: () => void;
  onEnlarge: () => void;
  frame: ReplayFrame | null; playing: boolean;
}) {
  const protectedMode = variant === "protected", m: SafetyMetrics = scenario[variant].metrics;
  const vla = report.models.vla ? modelName(report.models.vla.id) : null;
  const single = report.presentation === "single-example";
  const [videoAspect, setVideoAspect] = useState("2 / 3");
  const start = scenario[variant].initial?.knife_clearance_m, end = scenario[variant].final?.knife_clearance_m;
  const closer = typeof start === "number" && typeof end === "number" && end < start;
  const motion = m.executed_steps === 0 ? "Held position" : closer ? "Moved closer to the person" : "Motion executed";
  const liveClearance = single && frame ? replayClearance(scenario[variant], frame.physicsTime) : null;
  return <article className={`${s.recording} ${protectedMode ? s.protected : s.baseline}`}>
    <header><div><span className={s.kicker}>{protectedMode ? "02 / Protected" : "01 / Baseline"}</span><h3>{vla ? protectedMode ? `${vla} + Sapling` : `${vla} alone` : protectedMode ? "With Sapling" : "Without safety gate"}</h3></div>
      {!single && <span className={`${s.pill} ${m.unsafe_executed_steps ? s.dangerPill : s.safePill}`}>{m.unsafe_executed_steps ? `${m.unsafe_executed_steps} unsafe steps executed` : "0 unsafe steps executed"}</span>}
      <button className={s.fullscreen} type="button" disabled={!scenario.videos[variant]} onClick={onEnlarge} aria-label={`Enlarge ${protectedMode ? "protected" : "baseline"} recording`}>Enlarge view ↗</button>
    </header>
    {single && frame && report.rendering?.fps !== 60 && <CommandFlow scenario={scenario} variant={variant} frame={frame} playing={playing} source={vla || "Planner"} />}
    <div className={s.videoFrame} style={single ? { aspectRatio: videoAspect } : undefined}>
      {scenario.videos[variant] ? <video ref={videoRef} src={safetyVideoUrl(report.run_id, scenario.id, variant, single ? "stacked" : undefined)} preload="metadata" playsInline muted onLoadedMetadata={event => { const video = event.currentTarget; if (single && video.videoWidth && video.videoHeight) setVideoAspect(`${video.videoWidth} / ${video.videoHeight}`); }} onTimeUpdate={onTime} onEnded={onEnded} onError={onError} aria-label={`${scenario.title}: ${protectedMode ? "Sapling protected" : "unprotected baseline"} recording`} /> : <div className={s.noVideo}>Recording not available for this case.</div>}
      <span className={s.videoCaption}>{vla ? protectedMode ? `${vla} action → Sapling → action gate → robot` : `${vla} action → robot` : protectedMode ? "Candidate action → Sapling → gate → robot" : "Candidate action → robot"}</span>
    </div>
    {single ? <div className={s.clearanceResult}><b className={m.unsafe_executed_steps ? s.bad : s.good}>{motion}</b><span>{liveClearance !== null ? <><i className={playing ? s.liveTelemetry : s.pausedTelemetry} />{playing ? "LIVE REPLAY" : "REPLAY"} · knife–person clearance</> : "Knife–person clearance"}</span><strong>{liveClearance !== null ? <>{number(liveClearance * 100, 1)}<small> cm · interpolated recorded telemetry</small></> : <>{typeof start === "number" ? number(start * 100, 1) : "?"} → {typeof end === "number" ? number(end * 100, 1) : "?"}<small> cm · start → end</small></>}</strong>{liveClearance !== null && <small>Start {typeof start === "number" ? number(start * 100, 1) : "?"} cm → end {typeof end === "number" ? number(end * 100, 1) : "?"} cm</small>}</div> : <div className={s.recordingMetrics}>
      <div><strong>{m.executed_steps}</strong><span>steps executed</span></div>
      <div><strong>{m.blocked_steps}</strong><span>steps blocked</span></div>
      <div><strong className={m.contacts_with_person ? s.bad : ""}>{m.contacts_with_person}</strong><span>person contacts</span></div>
      <div><strong>{number(m.max_joint_displacement_rad, 3)}</strong><span>max joint change · rad</span></div>
    </div>}
  </article>;
}

function CaseView({ report, scenario, onSelect }: { report: SafetyReport; scenario: SafetyCase; onSelect: (id: string) => void }) {
  const baseline = useRef<HTMLVideoElement>(null), protectedVideo = useRef<HTMLVideoElement>(null);
  const theater = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false), [videoError, setVideoError] = useState("");
  const [playbackRate, setPlaybackRate] = useState(report.presentation === "single-example" ? 1 : report.task === "knife-handover" ? 0.5 : 1);
  const [enlarged, setEnlarged] = useState(report.task === "knife-handover" && report.presentation !== "single-example");
  const [focusedView, setFocusedView] = useState<"baseline" | "protected" | null>(null);
  const [phaseIndex, setPhaseIndex] = useState(() => Math.max(0, scenario.steps.findIndex(step => !step.oracle_safe))), [time, setTime] = useState(0);
  const step = scenario.steps[phaseIndex] || scenario.steps[0];
  const knife = report.task === "knife-handover";
  const single = report.presentation === "single-example";
  const vla = report.models.vla ? modelName(report.models.vla.id) : null;
  const replay = replayFrame(report, time);
  const instruction = step.instruction || scenario.attack;
  const action = step.action || (Array.isArray(step.plan.action) ? step.plan.action as number[] : undefined);
  const verifierEvidence = useMemo(() => formatJson({ instruction: step.instruction, action, vla_call: step.vla_call, telemetry: step.telemetry, fields: step.fields, state: step.state, plan: step.plan }), [step, action]);
  const controllerEvidence = useMemo(() => formatJson({ call: step.call, decision: step.decision, execute: step.execute, oracle_safe: step.oracle_safe }), [step]);
  const vlaEvidence = useMemo(() => formatJson(step.vla_call), [step.vla_call]);
  const bothVideos = !!scenario.videos.baseline && !!scenario.videos.protected;
  const videos = () => [baseline.current, protectedVideo.current].filter((v): v is HTMLVideoElement => !!v);
  function pause() { videos().forEach(v => v.pause()); setPlaying(false); }
  async function play(replay = false) {
    const list = videos();
    if (list.length !== 2) return;
    const target = replay || baseline.current?.ended ? 0 : (baseline.current?.currentTime || 0);
    list.forEach(v => { v.currentTime = target; v.playbackRate = playbackRate; });
    setTime(target);
    setVideoError("");
    const results = await Promise.allSettled(list.map(v => v.play()));
    if (results.some(r => r.status === "rejected")) { pause(); setVideoError("Playback could not start. Check that both recordings are available, then replay."); }
    else setPlaying(true);
  }
  const sync = () => {
    const a = baseline.current, b = protectedVideo.current;
    if (!a || !b) return;
    setTime(a.currentTime);
    if (!b.ended && Math.abs(b.currentTime - a.currentTime) > .25) b.currentTime = Math.min(a.currentTime, Number.isFinite(b.duration) ? b.duration : a.currentTime);
  };
  useEffect(() => () => { baseline.current?.pause(); protectedVideo.current?.pause(); }, []);
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => { const video = baseline.current; if (video) setTime(video.currentTime); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);
  useEffect(() => { if (single && playing && replay) setPhaseIndex(replay.stepIndex); }, [single, playing, replay?.stepIndex]);
  useEffect(() => { [baseline.current, protectedVideo.current].forEach(video => { if (video) video.playbackRate = playbackRate; }); }, [playbackRate]);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setEnlarged(false); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, []);
  useEffect(() => {
    const root = theater.current;
    if (!enlarged || !root) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(root.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), a[href]")).filter(el => el.getClientRects().length > 0);
    controls()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    root.addEventListener("keydown", trap);
    return () => { root.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, [enlarged]);
  return <div className={`${s.caseView} ${single ? s.singleCase : ""}`}>
    {!single && <div className={s.caseHeading}><div><span className={s.kicker}>{label(scenario.split)} / {label(scenario.category)}</span><h2>{scenario.title}</h2></div>
      <span className={`${s.pill} ${scenario.expected_safe ? s.safePill : s.dangerPill}`}>{knife ? scenario.split === "control" ? "Safe control" : step.oracle_safe ? "Policy-compliant proposal" : "Policy-violating proposal" : scenario.expected_safe ? "Safe control" : "Unsafe challenge"}</span>
    </div>}
    <div className={s.attack}><span className={s.kicker}>{single ? "The exact instruction" : report.models.vla ? "Exact VLA instruction" : scenario.expected_safe ? "Control condition" : "Adversarial request"}</span><blockquote>{instruction ? `“${instruction}”` : "No adversarial instruction recorded for this control."}</blockquote>{report.models.vla && !single && <small className={s.promptNote}>{step.oracle_safe ? "The recorded proposed action satisfies the scored policy." : "The recorded proposed action violates the scored policy."} See the raw action and telemetry below.</small>}</div>
    <div ref={theater} className={`${s.theater} ${enlarged ? s.enlarged : ""} ${enlarged && focusedView === "baseline" ? s.focusedBaseline : ""} ${enlarged && focusedView === "protected" ? s.focusedProtected : ""}`} role={enlarged ? "dialog" : undefined} aria-modal={enlarged ? true : undefined} aria-label={enlarged ? "Enlarged synchronized simulation comparison" : undefined}>
    {enlarged && <div className={s.theaterTitle}><div className={s.theaterHeading}><b>{single && vla ? `${vla} alone / ${vla} + Sapling` : scenario.title}</b>{!single && <select aria-label="Theater scenario" value={scenario.id} onChange={e => onSelect(e.target.value)}>{report.cases.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select>}</div><span className={s.theaterPrompt}>{instruction}</span>{report.models.vla && <small>{single ? `${report.models.vla.domain_shift_note} Sapling checks the policy and scene geometry.` : <>{report.models.vla.id} · revision {report.models.vla.revision.slice(0, 12)} · {report.models.vla.domain_shift_note}{!report.models.mubit_adapter && " No Mubit fine-tuned adapter used."}</>}</small>}{!single && <><div className={s.theaterSummary}><span>Unsafe steps: <b>{report.summary.baseline_unsafe_executed_steps} → {report.summary.protected_unsafe_executed_steps}</b></span><span>{knife ? "Unsafe episodes blocked" : "Unsafe scenarios blocked"}: <b>{report.summary.unsafe_blocked}/{report.summary.unsafe_blocked + report.summary.unsafe_allowed}</b></span><span>{knife ? "Safe episodes fully approved" : "Safe controls approved"}: <b>{report.summary.safe_allowed}/{report.summary.safe_allowed + report.summary.safe_blocked}</b> · {report.summary.safe_blocked} {knife ? "false-positive episode stops" : "false-positive control blocks"}</span></div>{knife && <><ProposalCounts report={report} /><p className={s.latchNote}>Protected execution stops for the episode after the first rejection. Later raw approvals do not restart motion.</p></>}</>}</div>}
    <div className={s.transport}>
      <div><button type="button" className={s.primaryButton} disabled={!bothVideos} onClick={() => playing ? pause() : void play()}>{playing ? "Ⅱ Pause both" : "▶ Play both"}</button><button type="button" disabled={!bothVideos} onClick={() => void play(true)}>↺ Replay</button><label className={s.playbackSpeed}>Playback speed <select aria-label="Synchronized playback speed" value={playbackRate} onChange={e => setPlaybackRate(Number(e.target.value))}>{[0.5, 1, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label><button type="button" aria-pressed={enlarged} onClick={() => { setEnlarged(v => !v); setFocusedView(null); }}>{enlarged ? "✕ Close theater" : "⛶ Enlarge pair"}</button>{enlarged && focusedView && <button type="button" onClick={() => setFocusedView(null)}>Show both views</button>}</div>
      <span className={s.note}>{number(time, 1)} s · {report.cameras?.length ? report.cameras.map(label).join(" + ") : "matched scene and candidate plan"} · synchronized</span>
    </div>
    <div className={s.comparison}>
      <Recording report={report} scenario={scenario} variant="baseline" frame={replay} playing={playing} videoRef={baseline} onTime={sync} onEnded={pause} onEnlarge={() => { setFocusedView("baseline"); setEnlarged(true); }} onError={() => { pause(); setVideoError("Baseline recording failed to load."); }} />
      <Recording report={report} scenario={scenario} variant="protected" frame={replay} playing={playing} videoRef={protectedVideo} onEnded={() => { if (baseline.current?.ended) setPlaying(false); }} onEnlarge={() => { setFocusedView("protected"); setEnlarged(true); }} onError={() => { pause(); setVideoError("Protected recording failed to load."); }} />
    </div>
    </div>
    {single && report.models.vla && <p className={s.singleDisclosure}>{report.models.vla.domain_shift_note} Sapling receives the policy and scene geometry.</p>}
    {videoError && <p role="alert" className={s.error}>{videoError}</p>}
    <EvidenceDisclosure collapsed={single}><section className={s.evidence}>
      <div className={s.evidenceHead}><div><span className={s.kicker}>Decision evidence</span><h3>Inspect the safety boundary</h3></div>
        <div className={s.phases} aria-label="Select decision phase">{scenario.steps.map((p, i) => <button type="button" key={`${p.phase}-${i}`} title={`${p.decision.allow ? "Sapling approved" : "Sapling rejected"}${p.execute !== undefined ? p.execute ? "; executed" : "; held" : ""}`} aria-pressed={phaseIndex === i} onClick={() => setPhaseIndex(i)}><i className={p.decision.allow ? s.dotGood : s.dotBad} />{label(p.phase)}</button>)}</div>
      </div>
      <div className={s.evidenceGrid}>
        <div className={s.telemetry}><h3>Trusted scene telemetry</h3>
          <dl>{knife ? Object.entries(step.telemetry || {}).map(([name, value]) => <div key={name}><dt>{label(name)}</dt><dd>{typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "number" ? number(value, 4) : typeof value === "string" ? value : formatJson(value)}</dd></div>) : <><div><dt>Person clearance</dt><dd>{step.person_m == null ? "No person detected" : `${number(step.person_m, 2)} m`}</dd></div><div><dt>Target bowl localized</dt><dd>{step.bowl_known ? "Yes" : "No"}</dd></div></>}<div><dt>Policy oracle</dt><dd className={step.oracle_safe ? s.good : s.bad}>{step.oracle_safe ? "Safe candidate" : "Unsafe candidate"}</dd></div></dl>
          <p className={s.state}>{step.state}</p>
          <h3>Candidate action</h3>
          {knife ? <><p className={s.kicker}>Recorded 7-dimensional action</p><pre className={s.actionVector}>{action ? `[${action.map(n => number(n, 6)).join(", ")}]` : "No action vector recorded."}</pre>{step.vla_call && <details className={s.details}><summary>{vla || "Model"} inference provenance</summary><pre className={s.actionVector}>{vlaEvidence}</pre></details>}</> : <dl><div><dt>Arm speed{rangeOf(report, "arm_speed")}</dt><dd>{step.plan.arm_speed}</dd></div><div><dt>Pour height{rangeOf(report, "pour_height_cm")}</dt><dd>{step.plan.pour_height_cm} cm</dd></div><div><dt>Tilt speed{rangeOf(report, "tilt_speed")}</dt><dd>{step.plan.tilt_speed}</dd></div><div><dt>Tilt angle{rangeOf(report, "tilt_angle_deg")}</dt><dd>{step.plan.tilt_angle_deg}°</dd></div></dl>}
          <p className={s.note}>{step.plan.justification}</p>
        </div>
        <Probabilities step={step} />
      </div>
      <div className={`${s.decision} ${(knife ? step.execute === true : step.decision.allow) ? s.decisionAllow : s.decisionBlock}`}><Shield /><div><b>{knife ? step.decision.allow ? "Proposal approved by Sapling" : "Proposal rejected by Sapling" : step.decision.allow ? "Action allowed" : "Action blocked before execution"}</b><p>{step.decision.reason}</p>{knife && <p className={s.actuation}>{step.execute === true ? "Protected branch: action executed." : step.execute === false ? step.decision.allow ? "Protected branch: held. An earlier rejection latched the episode stop; this later raw approval did not execute." : "Protected branch: held. Rejection latches the episode stop." : "Protected execution status was not recorded for this proposal."}</p>}<span>{step.decision.source === "fail-closed" ? "Fail-closed controller" : "Sapling decision"} · {step.phase}</span></div></div>
      <details className={s.details}><summary>Full prompt, response & execution evidence <span>JSON ↓</span></summary><div className={s.rawGrid}><div><h4>Verifier input & VLA source</h4><pre>{verifierEvidence}</pre></div><div><h4>Recorded call & controller decision</h4><pre>{controllerEvidence}</pre></div></div></details>
    </section></EvidenceDisclosure>
  </div>;
}

function Comparison({ result }: { result: SafetyResult }) {
  const report = result.report!;
  const [selected, setSelected] = useState(report.featured_case_id || report.cases[0].id);
  const [filter, setFilter] = useState("all");
  const scenario = report.cases.find(c => c.id === selected) || report.cases[0], summary = report.summary;
  const knife = report.task === "knife-handover";
  const matches = (c: SafetyCase, f: string) => f === "all" || (f === "control" ? c.expected_safe : f === "held_out" ? c.split === "held_out" : !c.expected_safe);
  const shown = report.cases.filter(c => matches(c, filter));
  const selectFilter = (id: string) => { setFilter(id); const first = report.cases.find(c => matches(c, id)); if (first && !matches(scenario, id)) setSelected(first.id); };
  return <div className={`${s.lab} ${knife ? s.knifeLab : ""}`}>
    <section className={s.hero}>
      <div><span className={s.eyebrow}><Shield /> {knife ? "KNIFE HANDOVER / VLA SAFETY EVALUATION" : "ADVERSARIAL ROBOTICS / SAFETY EVALUATION"}</span><h1>{knife && report.models.vla ? `${modelName(report.models.vla.id)}, with and without Sapling.` : <>A safety layer between<br />intent and action.</>}</h1><p>{knife && report.models.vla ? `The recorded ${modelName(report.models.vla.id)} proposals, replayed with and without the Sapling gate.` : <>The same candidate actions. The same simulated scene.<br />One robot executes directly. One checks with Sapling first.</>}</p></div>
      <div className={s.runStamp}><span className={s.liveDot} /> LIVE MODEL EVIDENCE<dl><div><dt>Simulator</dt><dd>{report.simulation.engine} / {report.simulation.host}</dd></div><div><dt>{report.completed_at ? "Completed" : "Captured"}</dt><dd>{new Date(report.completed_at || report.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd></div><div><dt>Run</dt><dd title={report.run_id}>{report.run_id}</dd></div></dl><a href={safetyReportUrl(report.run_id)} target="_blank" rel="noreferrer">Open raw report ↗</a></div>
    </section>
    {report.models.vla && <div className={s.vlaProvenance}><span className={s.kicker}>Actual VLA inference</span><b>{report.models.vla.id}</b><span title={report.models.vla.revision}>revision {report.models.vla.revision.slice(0, 12)} · {report.models.vla.unnorm_key}</span><p>{report.models.vla.domain_shift_note}</p><span>{report.models.mubit_adapter ? "Mubit adapter recorded." : "No Mubit fine-tuned adapter used."}</span></div>}
    <section className={s.scoreboard} aria-label="Observed comparison results">
      <Metric title="Unsafe steps executed" value={`${summary.baseline_unsafe_executed_steps} → ${summary.protected_unsafe_executed_steps}`} note="Baseline → Sapling protected" tone={summary.protected_unsafe_executed_steps === 0 ? "good" : "bad"} />
      <Metric title={knife ? "Unsafe episodes blocked" : "Unsafe scenarios blocked"} value={`${summary.unsafe_blocked} / ${summary.unsafe_blocked + summary.unsafe_allowed}`} note={`${summary.unsafe_allowed} ${knife ? "episodes with unsafe raw approvals" : "unsafe scenarios allowed"}`} tone={summary.unsafe_allowed ? "bad" : "good"} />
      <Metric title={knife ? "Safe episodes fully approved" : "Safe controls approved"} value={`${summary.safe_allowed} / ${summary.safe_allowed + summary.safe_blocked}`} note={`${summary.safe_blocked} ${knife ? "false-positive episode stops" : "false-positive control blocks"} · ${summary.safe_controls} controls`} tone={summary.safe_blocked ? "neutral" : "good"} />
      <Metric title="Sapling response" value={`${number(summary.sapling_latency_ms.median)} ms`} note={`Median · p95 ${number(summary.sapling_latency_ms.p95)} ms · ${summary.sapling_calls} calls`} />
    </section>
    {knife && <><ProposalCounts report={report} /><p className={s.latchNote}>The protected branch holds for the rest of an episode after its first rejection. Later raw approvals are recorded, but do not resume execution.</p></>}
    {!!summary.verifier_errors && <p className={s.error} role="status">{summary.verifier_errors} verifier calls failed. Their fail-closed stops are included in blocked decisions above; they are not successful model classifications. Inspect each call&apos;s source and error below.</p>}
    {report.validation?.reference_probe && <p className={s.probeNotice}>Wider reference probe: <b>{report.validation.reference_probe.correct}/{report.validation.reference_probe.cases} correct</b> · <b className={report.validation.reference_probe.unsafe_approved ? s.bad : s.good}>{report.validation.reference_probe.unsafe_approved}/{report.validation.reference_probe.unsafe_cases} unsafe candidates approved.</b> <a href="#wider-probe">Inspect the limitations ↓</a></p>}
    <div className={s.workspace}>
      <aside className={s.scenarios}><div className={s.scenarioTitle}><h2>Scenarios</h2><span>{summary.cases}</span></div>
        <div className={s.filters} aria-label="Filter scenarios">{[["all", "All"], ["unsafe", "Attacks"], ["control", "Controls"], ["held_out", "Held out"]].map(([id, text]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => selectFilter(id)}>{text}</button>)}</div>
        <nav aria-label="Safety scenarios">{shown.map((c, index) => <button key={c.id} type="button" aria-current={selected === c.id ? "true" : undefined} onClick={() => setSelected(c.id)}><span className={s.caseNumber}>{String(index + 1).padStart(2, "0")}</span><span><b>{c.title}</b><small>{label(c.category)} · {label(c.split)}</small></span><i className={c.protected.metrics.unsafe_executed_steps || (c.expected_safe && c.protected.metrics.blocked_steps) ? s.dotBad : s.dotGood} /></button>)}</nav>
        {!shown.length && <p className={s.note}>No cases in this group.</p>}
        <div className={s.legend}><span><i className={s.dotGood} /> No unsafe motion / safe allowed</span><span><i className={s.dotBad} /> Unsafe motion / control blocked</span></div>
        <div className={s.modelInfo}><span className={s.kicker}>Recorded model stack</span><dl><dt>{report.models.vla ? "VLA policy" : "Planner"}</dt><dd>{report.models.vla?.id || report.models.planner}</dd><dt>Safety verifier</dt><dd>{report.models.sapling}</dd><dt>Weights</dt><dd>{report.models.sapling_weights}</dd></dl><p>{report.models.mubit_adapter ? "Mubit adapter recorded." : "Mubit fine-tuned adapter was not used in this run."}</p><small>{summary.mubit_calls} Mubit calls recorded.</small></div>
      </aside>
      <CaseView key={`${report.run_id}/${scenario.id}`} report={report} scenario={scenario} onSelect={setSelected} />
    </div>
    {report.validation?.reference_probe && <section id="wider-probe" className={s.validation} aria-label="Wider reference probe results">
      <div><span className={s.kicker}>Wider reference probe</span><h3>Keep the failures in view.</h3><p>This separate probe checks model labels beyond the showcase above.</p></div>
      <div><strong>{report.validation.reference_probe.correct} / {report.validation.reference_probe.cases}</strong><span>correct top-label decisions</span></div>
      <div><strong className={report.validation.reference_probe.unsafe_approved ? s.bad : s.good}>{report.validation.reference_probe.unsafe_approved} / {report.validation.reference_probe.unsafe_cases}</strong><span>unsafe candidates approved</span></div>
      <p className={s.note}>{report.validation.batching_disabled ? "Dynamic batching disabled for this deployment." : "Batching configuration not recorded."}{typeof report.validation.batch_max_logit_diff === "number" && ` Batch parity check: max logit difference ${number(report.validation.batch_max_logit_diff, 4)}.`} This result is separate from the matched recordings.</p>
    </section>}
    <footer className={s.limits}><div><span className={s.kicker}>Read the result correctly</span><h3>Evidence from this evaluation, not a universal guarantee.</h3><p>{report.simulation.description}</p><ul>{report.limitations.map((limit, i) => <li key={i}>{limit}</li>)}</ul>{result.rejected > 0 && <p>{result.rejected} invalid or non-live reports excluded.</p>}</div><details><summary>Safety policy</summary><pre>{report.policy}</pre></details></footer>
  </div>;
}

function SingleExample({ result, onSelectRun }: { result: SafetyResult; onSelectRun: (id: string) => void }) {
  const report = result.report!;
  const scenario = report.cases.find(c => c.id === report.featured_case_id) || report.cases[0];
  return <div className={s.singleLab}>
    <header className={s.singleIntro}><span className={s.eyebrow}><Shield /> ONE SELECTED DEMONSTRATION</span><h1>{scenario.protected.metrics.executed_steps === 0 ? "One request. Sapling stops the motion." : "One instruction. A safety boundary."}</h1><p>The same real {report.models.vla ? modelName(report.models.vla.id) : "model"} actions, with and without Mubit Labs’ Sapling verifier.</p></header>
    <CaseView key={`${report.run_id}/${scenario.id}`} report={report} scenario={scenario} onSelect={() => {}} />
    <details className={s.singleEvidence}><summary>Run details & limitations <span>↓</span></summary><div className={s.singleRunDetails}><p>{report.simulation.description}</p><ul>{report.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul><p>VLA: {report.models.vla?.id || report.models.planner}{report.models.vla && <> · revision {report.models.vla.revision}</>}. Safety verifier: {report.models.sapling}.</p><p>{report.models.mubit_adapter ? "Mubit adapter recorded." : "No Mubit fine-tuned task adapter was used."}</p><a href={safetyReportUrl(report.run_id)} target="_blank" rel="noreferrer">Open this run&apos;s full recorded evidence ↗</a>{result.reports?.some(r => r.run_id !== report.run_id) && <details className={s.previousRuns}><summary>Previous recorded comparisons</summary>{result.reports.filter(r => r.run_id !== report.run_id).map(r => <button key={r.run_id} type="button" onClick={() => onSelectRun(r.run_id)}>{taskLabel(r.task)} · {r.run_id} ↗</button>)}</details>}</div></details>
  </div>;
}

export default function Safety() {
  const [result, setResult] = useState<SafetyResult | null>(null), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true);
  const selectReport = async (id: string) => { setLoading(true); setError(""); try { const report = await getSafetyReport(id); setResult(previous => previous ? { ...previous, report } : { report, rejected: 0 }); } catch (e) { setError(e instanceof Error ? e.message : "Could not read selected report."); } finally { setLoading(false); } };
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    getSafety(controller.signal).then(setResult).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not read comparison report."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  return <>
    <PanelSub>{result?.report?.presentation === "single-example" ? `Recorded ${result.report.models.vla ? modelName(result.report.models.vla.id) : "model"} + Sapling demonstration` : result?.report ? <><b>{result.report.summary.cases}</b> recorded cases · live models / simulated physics</> : "Recorded live evaluations"}</PanelSub>
    <PanelActions>{result?.report?.presentation !== "single-example" && (result?.reports?.length || 0) > 1 && <select className={s.reportSelect} aria-label="Recorded safety evaluation" value={result?.report?.run_id || ""} disabled={loading} onChange={e => void selectReport(e.target.value)}>{result?.reports?.map(r => <option key={r.run_id} value={r.run_id}>{taskLabel(r.task)} · {r.cases} cases · {r.run_id}</option>)}</select>}<button type="button" className="btn sm" disabled={loading} onClick={() => setRefresh(v => v + 1)}>{loading ? "Reading…" : result?.report?.presentation === "single-example" ? "Reload" : "Refresh evidence"}</button></PanelActions>
    {error ? <div className={s.empty} role="alert"><Shield /><h1>Evidence could not be loaded</h1><p>{error}</p><button type="button" className="btn" onClick={() => setRefresh(v => v + 1)}>Try again</button></div>
      : loading && !result ? <div className={s.empty} role="status"><Shield /><h1>Reading simulation evidence…</h1><p>Loading the latest completed live report.</p></div>
      : result?.report ? result.report.presentation === "single-example" ? <SingleExample key={result.report.run_id} result={result} onSelectRun={id => void selectReport(id)} /> : <Comparison key={result.report.run_id} result={result} />
      : <div className={s.empty}><Shield /><span className={s.kicker}>SAFETY LAB / AWAITING EVIDENCE</span><h1>Ready for the real comparison.</h1><p>No completed live Modal evaluation is available yet. Run the safety simulation to compare matched baseline and protected actions.</p><code>runs/security/&lt;run_id&gt;/report.json</code>{!!result?.rejected && <p>{result.rejected} invalid or non-live reports were excluded.</p>}<p className={s.note}>This page reads recorded evidence. It never starts a paid model call.</p></div>}
  </>;
}
