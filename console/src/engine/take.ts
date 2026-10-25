// Open a real Steward take (runs/takes/<take>.jsonl) and turn each attempt into a
// replayable episode. Real timestamps stay in the log; the replay is re-timed with
// standard durations because the take's own gaps are model latency, not motion.

import { r2, wordsOf, EPOCH } from "./format";
import { pushLog } from "./state";
import { TASKS, PHASE_DUR } from "./world";
import type { Store } from "./store";
import type { Episode, Robot, SEvent } from "./types";

export function importTake(store: Store, text: string, fileName: string) {
  const st = store.state, emit = (e: string, p?: unknown) => store.emit(e, p);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((o): o is SEvent => !!o && typeof o === "object" && typeof o.kind === "string");
  if (!lines.length) throw new Error('No Steward events found. Each line should be a JSON object with a "kind" field.');
  const takeName = String(lines.find((l) => l.take)?.take || fileName.replace(/\.[^.]+$/, ""));
  const groups: Record<string, { eps: { raw: SEvent[] }[]; cur: { raw: SEvent[] } | null }> = {};
  for (const e of lines) {
    const id = String(e.robot || "robot");
    const g = groups[id] || (groups[id] = { eps: [], cur: null });
    if (e.kind === "attempt" || !g.cur) { g.cur = { raw: [] }; g.eps.push(g.cur); }
    g.cur.raw.push(e);
  }
  const made: Robot[] = [];
  for (const [rawId, g] of Object.entries(groups)) {
    const id = `take-${rawId}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    let r = st.byId[id];
    if (!r) {
      r = { id, name: rawId.toUpperCase(), task: "pour", model: "Imported take", env: takeName, imported: true, history: [], count: 0, cur: 0, queued: null, lastEv: null, ep: undefined as unknown as Episode };
      st.robots.push(r); st.byId[id] = r;
    }
    for (const grp of g.eps) {
      const ep = retime(r, grp.raw);
      r.history.push(ep); st.episodes[ep.id] = ep; r.ep = ep;
      for (const e of ep.events) pushLog(st, { abs: typeof e.t === "number" ? e.t - EPOCH : st.simNow, robot: id, kind: e.kind, data: e, epId: ep.id, at: e.at }, emit);
    }
    made.push(r);
  }
  emit("robots");
  return { robots: made, events: lines.length, take: takeName };
}

function retime(r: Robot, raw: SEvent[]): Episode {
  const task = TASKS.pour;
  const att = raw.find((e) => e.kind === "attempt");
  const rawPlan = raw.find((e) => e.kind === "plan")?.plan || {};
  const plan: Record<string, number> = { ...task.prior };
  for (const k of Object.keys(task.params)) if (rawPlan[k] != null) plan[k] = Number(rawPlan[k]);
  const subject = String(att?.subject || "an imported attempt");
  r.count++;
  const ep: Episode = {
    id: `${r.id}-${r.count}`, n: Number(att?.attempt) || r.count, robot: r.id, task: "pour", start: 0, imported: true,
    variant: { subject, applies: [...wordsOf(subject)].slice(0, 3), phrase: subject, contents: "contents", bowl: /narrow/.test(subject) ? "narrow" : "wide", ideal: {} },
    lessons: (raw.find((e) => e.kind === "lessons")?.lessons || []).map((l: { id: string; text: string }) => ({ id: l.id, text: l.text, source: "fleet", settings: {} })),
    cands: [{ plan: { ...plan }, score: 1, violation: null }], chosen: 0, plan, justification: String(rawPlan.justification || ""),
    success: false, p: 1, worst: null, override: null,
    events: [], segs: [], person: null, failAt: null, metric: 0, reason: "", outcome: "", lessonWritten: null, holds: 0, duration: 0,
  };
  let t = 0, pending: number | null = null;
  const decide = (d: number, what: string) => { ep.segs.push({ kind: "decide", t0: t, t1: t + d, task: what }); t += d; };
  for (const e of raw) {
    if (e.kind === "plan") decide(1.0, "plan");
    else if (e.kind === "phase") pending = Math.max(0, task.phases.indexOf(e.phase));
    else if (e.kind === "safety") decide(0.5, "verify");
    else if (e.kind === "lesson") { decide(0.8, "lesson"); ep.lessonWritten = e.lesson?.id || null; }
    ep.events.push({ ...e, at: r2(t) });
    if (e.kind === "hold") { ep.segs.push({ kind: "hold", t0: t, t1: t + 2.4 }); t += 2.4; ep.holds++; }
    if (e.kind === "safety" && e.label === "supported" && e.status !== "unsure" && pending != null) {
      const dur = PHASE_DUR.pour[pending] || 2.4;
      ep.segs.push({ kind: "motion", phase: pending, t0: t, t1: t + dur });
      t += dur; pending = null;
    }
    if (e.kind === "attempt" || e.kind === "lessons") t += 0.2;
    if (e.kind === "result") { ep.resultAt = t; t += 0.35; }
  }
  const result = raw.find((e) => e.kind === "result"), outcome = raw.find((e) => e.kind === "outcome")?.outcome;
  ep.success = !!result?.success;
  ep.outcome = outcome === "stopped" ? "stopped" : outcome === "success" || ep.success ? "success" : outcome === "failed" || result ? "failed" : "stopped";
  ep.reason = String(result?.reason || raw.find((e) => e.kind === "escalate")?.reason || raw.find((e) => e.kind === "error")?.error || "No result was logged.");
  ep.metric = ep.outcome === "success" ? 1 : ep.outcome === "failed" ? 12 : 0;
  const pourSeg = ep.segs.find((s) => s.kind === "motion" && s.phase === 1);
  if (ep.outcome === "failed" && pourSeg) ep.failAt = pourSeg.t0 + 0.45 * (pourSeg.t1 - pourSeg.t0);
  if (ep.outcome === "failed") ep.worst = { k: "tilt_speed", dir: "hi" };
  ep.duration = t + 0.6;
  return ep;
}
