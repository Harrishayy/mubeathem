// The simulated fleet (the demo source, src/sources/demo): Steward's loop (recall, plan,
// verify, act, check, learn) run in the browser, writing the same events Steward writes
// to runs/takes/<take>.jsonl. The real-runs source (src/sources/runs) fills the same
// state from Steward's logs instead; panels don't know which is running.

import { makeRng } from "./random";
import { clamp, r2, roundP, fmtP, wordsOf } from "./format";
import { pushLog } from "./state";
import { TASKS, ROBOTS, PHASE_DUR, FAIL_PHASE, FAIL_U, HIST, GAP, MUBIT_CFG, KEEP_TO_TRAIN, failReason, successReason, okReason } from "./world";
import type { Store } from "./store";
import type { Candidate, Episode, Lesson, Robot, SEvent, Settings, Task, Variant } from "./types";

export function createSim(store: Store) {
  const S = store.state;
  const rng = makeRng();
  const emit = (e: string, p?: unknown) => store.emit(e, p);

  // ---- Mubit ----
  function latency(task: string) {
    const m = S.mubit[task], c = MUBIT_CFG[task];
    return Math.round(Math.max(80, (c.base + rng.gauss() * c.sd) * (m.state === "serving" ? 0.3 : 1)));
  }
  function mubitTick(abs: number) {
    for (const [k, m] of Object.entries(S.mubit)) {
      if (m.state === "training" && m.trainStart != null && abs - m.trainStart >= MUBIT_CFG[k].trainFor) {
        m.state = "serving"; m.servingSince = abs;
        S.adapterMarks.push({ task: k, abs, doneIdx: S.done.length });
        pushLog(S, { abs, robot: "mubit", kind: "adapter", data: { at: 0, kind: "adapter", robot: "mubit", task: k, adapter: `${k}-v1`, note: `${k} adapter v1 is serving` }, epId: null }, emit);
        emit("mubit"); emit("adapter", { task: k });
      }
    }
  }

  // ---- the loop's decisions ----
  function recall(taskKey: string, variant: Variant) {
    const ws = wordsOf(variant.subject);
    return S.lessons.filter((l) => {
      if (l.retired || l.task !== taskKey) return false;
      const keys = l.applies_to.filter((w) => /^[a-z]+$/.test(w));
      const hits = keys.filter((w) => ws.has(w)).length;
      return keys.length > 0 && hits >= Math.min(2, keys.length);
    });
  }
  // Mubit samples four candidate plans; the verifier ranks them and drops rule breakers.
  function samplePlans(task: Task, lessons: Lesson[]) {
    const base: Settings = { ...task.prior }, pinned = new Set<string>();
    for (const l of lessons) for (const [k, v] of Object.entries(l.settings)) { base[k] = v; pinned.add(k); }
    const cands: Candidate[] = [];
    for (let i = 0; i < 4; i++) {
      const p: Settings = {}; let dist = 0;
      for (const [k, [lo, hi]] of Object.entries(task.params)) {
        const spread = (hi - lo) * (pinned.has(k) ? 0.03 : 0.11);
        const top = k === task.limit.k ? hi + task.limit.over : hi;
        p[k] = roundP(k, clamp(base[k] + rng.gauss() * spread, lo, top));
        dist += Math.abs(p[k] - base[k]) / (hi - lo);
      }
      dist /= Object.keys(task.params).length;
      const score = r2(clamp(0.93 - dist * 2.4 + rng.gauss() * 0.03 + (pinned.size ? 0.03 : 0), 0.3, 0.98));
      const lim = task.limit;
      const violation = p[lim.k] > lim.max ? `Breaks rule 4: ${lim.k} ${fmtP(lim.k, p[lim.k])} is above ${fmtP(lim.k, lim.max)}.` : null;
      cands.push({ plan: p, score, violation });
    }
    let chosen = -1, best = -1;
    cands.forEach((c, i) => { if (!c.violation && c.score > best) { best = c.score; chosen = i; } });
    if (chosen < 0) { cands[0].plan[task.limit.k] = task.limit.max; cands[0].violation = null; chosen = 0; }
    return { cands, chosen };
  }
  // The world's hidden truth: how far each setting is from what this subject needs.
  function judge(variant: Variant, plan: Settings) {
    let worst: { k: string; dir: "hi" | "lo" } | null = null, d = 0;
    for (const [k, [ideal, tol]] of Object.entries(variant.ideal)) {
      const dk = Math.abs(plan[k] - ideal) / tol;
      if (!worst || dk > d) { d = dk; worst = { k, dir: plan[k] > ideal ? "hi" : "lo" }; }
    }
    return { p: d <= 1 ? 0.93 : Math.max(0.04, 0.93 - (d - 1) * 0.55), worst, d };
  }
  function writeLesson(robot: Robot, task: Task, variant: Variant, plan: Settings, worst: { k: string; dir: "hi" | "lo" }, recalled: Lesson[]): Lesson {
    const k = worst.k, [ideal, tol] = variant.ideal[k], [lo, hi] = task.params[k];
    const val = roundP(k, clamp(ideal + rng.gauss() * tol * 0.45, lo, hi));
    const applies = variant.applies.slice(0, rng.next() < 0.5 && variant.applies.length > 2 ? 3 : 2);
    const text = `For ${variant.phrase}, set ${k} to ${fmtP(k, val)}; ${fmtP(k, plan[k])} ${worst.dir === "hi" ? "was too high" : "was too low"}.`;
    const existing = recalled.find((l) => k in l.settings);
    if (existing) return { ...existing, text, settings: { ...existing.settings, [k]: val }, revised: true, revised_by: robot.id };
    return { id: `lesson-${++S.lessonSeq}`, task: robot.task, text, applies_to: applies, settings: { [k]: val }, source_robot: robot.id, uses: 0, successes: 0, created_abs: null, revisions: 0, revised: false };
  }
  function justify(lessons: Lesson[], override: Settings | null) {
    if (override) return `Operator fix: ${Object.entries(override).map(([k, v]) => `${k} ${fmtP(k, v)}`).join(", ")}.`;
    if (!lessons.length) return "No fleet lesson matches this subject, so the plan stays near the default settings.";
    return `Applied ${lessons.map((l) => l.id).join(" and ")}: ${lessons.map((l) => Object.entries(l.settings).map(([k, v]) => `${k} ${fmtP(k, v)}`).join(", ")).join("; ")}.`;
  }

  // ---- one episode, as a timeline of events and segments ----
  function genEpisode(robot: Robot, start: number, opts: { variant?: Variant; override?: Settings } = {}): Episode {
    const task = TASKS[robot.task];
    const variant = opts.variant || rng.pick(task.variants);
    const lessons = recall(robot.task, variant);
    const { cands, chosen } = samplePlans(task, lessons);
    const plan: Settings = { ...cands[chosen].plan, ...(opts.override || {}) };
    const j = judge(variant, plan);
    const success = rng.next() < j.p;
    const person = !opts.override && rng.next() < 0.13 ? { gate: rng.next() < 0.6 ? 0 : 1 } : null;
    const escalate = !opts.override && !person && rng.next() < 0.035;
    robot.count++;
    const ep: Episode = {
      id: `${robot.id}-${robot.count}`, n: robot.count, robot: robot.id, task: robot.task, variant, start,
      lessons: lessons.map((l) => ({ id: l.id, text: l.text, source: l.source_robot, settings: { ...l.settings } })),
      cands, chosen, plan, justification: justify(lessons, opts.override || null),
      success, p: j.p, worst: j.worst, override: opts.override || null,
      events: [], segs: [], person: null, failAt: null, metric: 0, reason: "", outcome: "", lessonWritten: null, holds: 0, duration: 0,
    };
    let t = 0;
    const ev = (kind: string, data: Record<string, unknown> = {}) => ep.events.push({ at: r2(t), kind, robot: robot.id, ...data } as SEvent);
    const call = (taskName: string, kept: boolean) => {
      const ms = latency(taskName);
      ep.segs.push({ kind: "decide", t0: t, t1: t + ms / 1000, task: taskName });
      t += ms / 1000;
      ev("call", { task: taskName, ms, request_id: rng.rid(), kept });
    };

    ev("attempt", { attempt: ep.n, subject: variant.subject });
    t += 0.2;
    ev("lessons", { lessons: ep.lessons.map((l) => ({ id: l.id, text: l.text })) });
    call("plan", success && !escalate);
    ev("plan", { attempt: ep.n, plan: { ...plan, justification: ep.justification }, sampled: cands.length, chosen });
    let stopped = false;
    task.phases.forEach((phase, i) => {
      if (stopped) return;
      ev("phase", { phase });
      if (escalate && i === 1) {
        call("verify", true);
        ev("safety", { phase, label: task.escalate.label, status: "unsure", reason: task.escalate.reason });
        ev("escalate", { phase, reason: task.escalate.reason });
        stopped = true;
        return;
      }
      if (person && person.gate === i) {
        const dist = r2(1.45 + rng.next() * 0.4);
        const enter = Math.max(0, t - 0.4);
        call("verify", true);
        ev("safety", { phase, label: "violation", status: "decided", reason: `Rule 2: a person is ${dist.toFixed(1)} m away and arm_speed is ${fmtP("arm_speed", plan.arm_speed)}, above 0.2.` });
        ev("hold", { phase, reason: "Holding until the person leaves the 2 m zone." });
        const hold = 2.2 + rng.next() * 1.4;
        ep.segs.push({ kind: "hold", t0: t, t1: t + hold });
        t += hold; ep.holds++;
        ep.person = { enter, leave: t, dist };
        call("verify", true);
        ev("safety", { phase, label: "supported", status: "decided", reason: "Nobody within 2 m now; every rule in the policy is met." });
      } else {
        call("verify", true);
        ev("safety", { phase, label: "supported", status: "decided", reason: okReason(robot.task, phase, plan) });
      }
      const dur = PHASE_DUR[robot.task][i] * (1.3 - plan.arm_speed * 0.6);
      ep.segs.push({ kind: "motion", phase: i, t0: t, t1: t + dur });
      if (!success && i === FAIL_PHASE[robot.task]) ep.failAt = t + dur * FAIL_U[robot.task];
      t += dur;
    });
    if (stopped) {
      ep.success = false; ep.outcome = "stopped"; ep.failAt = null;
      ep.reason = `Stopped before ${task.phases[1]}: ${task.escalate.reason}`;
    } else {
      const k = robot.task;
      ep.metric = success ? Math.floor(rng.next() * (k === "stack" ? 5 : 4))
        : k === "pour" ? 7 + Math.floor(rng.next() * 19) : k === "pick" ? 14 + Math.floor(rng.next() * 30) : 22 + Math.floor(rng.next() * 60);
      ep.reason = success ? successReason(k, variant, ep.metric) : failReason(k, variant, j.worst!, plan, ep.metric);
      ev("result", { attempt: ep.n, success, reason: ep.reason, [task.metric.name]: ep.metric });
      ep.resultAt = t;
      t += 0.35;
      if (!success) {
        const les = writeLesson(robot, task, variant, plan, j.worst!, lessons);
        call("lesson", true);
        ev("lesson", { lesson: { ...les, settings: { ...les.settings } }, revised: les.revised });
        ep.lessonWritten = les.id;
      }
      ep.outcome = success ? "success" : "failed";
    }
    ev("outcome", { outcome: ep.outcome });
    ep.duration = t + 0.6;
    return ep;
  }

  // ---- side effects of each event as the clock reaches it ----
  function fire(ep: Episode, e: SEvent) {
    const robot = S.byId[ep.robot];
    const abs = ep.start + e.at;
    if (e.kind === "call") {
      S.calls.push({ epId: ep.id, idx: ep.events.indexOf(e), abs, robot: e.robot, task: e.task, via: "mubit", ms: e.ms });
      if (S.calls.length > 4000) S.calls.splice(0, S.calls.length - 4000);
      const m = S.mubit[e.task];
      m.calls++; if (e.kept) m.kept = (m.kept ?? 0) + 1;
      m.lat.push({ ms: e.ms, serving: m.state === "serving" }); if (m.lat.length > 80) m.lat.shift();
      m.recent.unshift({ abs, robot: e.robot, task: e.task, ms: e.ms, request_id: e.request_id, kept: e.kept }); if (m.recent.length > 60) m.recent.pop();
      if (m.state === "collecting" && (m.kept ?? 0) >= KEEP_TO_TRAIN) { m.state = "training"; m.trainStart = abs; }
      emit("mubit");
    } else if (e.kind === "result") {
      const ids = new Set(ep.lessons.map((l) => l.id));
      for (const l of S.lessons) if (ids.has(l.id)) { l.uses++; l.successes += e.success ? 1 : 0; }
      emit("lessons");
    } else if (e.kind === "lesson") {
      const les = e.lesson as Lesson, found = S.lessons.find((l) => l.id === les.id);
      if (found) { found.text = les.text; found.settings = { ...les.settings }; found.revisions = (found.revisions || 0) + 1; found.revised_abs = abs; }
      else S.lessons.push({ ...les, settings: { ...les.settings }, uses: 0, successes: 0, created_abs: abs, revisions: 0 });
      emit("lessons");
    }
    if (robot && ["plan", "safety", "hold", "escalate", "result", "lesson"].includes(e.kind)) robot.lastEv = e;
    pushLog(S, { abs, robot: e.robot, kind: e.kind, data: e, epId: ep.id, at: e.at }, emit);
    emit("event", { ep, e });
  }
  function startEpisode(r: Robot, start: number) {
    const q = r.queued; r.queued = null;
    r.ep = genEpisode(r, start, q ? { override: q.override, variant: q.variant } : {});
    r.cur = 0; r.lastEv = null;
    S.episodes[r.ep.id] = r.ep;
  }
  function finalize(r: Robot) {
    const ep = r.ep;
    while (r.cur < ep.events.length) fire(ep, ep.events[r.cur++]);
    r.history.push(ep);
    S.done.push(ep);
    startEpisode(r, ep.start + ep.duration + GAP);
    emit("episode:done", { ep, robot: r });
  }
  function advance() {
    for (const r of S.robots) {
      if (r.imported) continue;
      const ep = r.ep;
      while (r.cur < ep.events.length && ep.start + ep.events[r.cur].at <= S.simNow) fire(ep, ep.events[r.cur++]);
      if (S.simNow >= ep.start + ep.duration + GAP) finalize(r);
    }
    mubitTick(S.simNow);
  }

  return {
    /** Build the fleet and run HIST seconds of history before anything is shown. */
    prefill() {
      for (const def of ROBOTS) {
        const r = { ...def, history: [], count: 0, cur: 0, queued: null, lastEv: null, ep: undefined as unknown as Episode } as Robot;
        S.robots.push(r); S.byId[r.id] = r;
      }
      for (const r of S.robots) startEpisode(r, -HIST + rng.next() * 6);
      for (let t = -HIST; t < 0; t += 0.2) { S.simNow = t; advance(); }
      S.simNow = 0;
    },
    tick(simDt: number) { S.simNow += simDt; advance(); },
  };
}
export type Sim = ReturnType<typeof createSim>;
