// The panel's state and rendering, shared by the live panel and the video player.
// apply() folds one event from a take's log into the state and returns what changed,
// so render() can animate just those parts.

const TASK_NAMES = { plan: "plan", verify: "safety check", lesson: "write lesson" };
const LABELS = {
  supported: "SUPPORTED", violation: "VIOLATION",
  insufficient_information: "INSUFFICIENT INFO", inconsistent_context: "INCONSISTENT",
};
const MAX_CALLS = 4;

export const PANEL_HTML = `
  <header>
    <h1>STEWARD</h1>
    <div class="via">every decision via <b>Mubit</b></div>
  </header>
  <section class="robots" data-slot="robots"></section>
  <section class="card">
    <h2>Fleet memory</h2>
    <ol data-slot="memory"></ol>
  </section>
  <section class="card">
    <h2>Calls through Mubit</h2>
    <ol class="calls" data-slot="calls"></ol>
  </section>`;

export function createState() {
  return { take: null, robots: new Map(), lessons: [], newIds: new Set(), calls: [], totalCalls: 0 };
}

function robot(state, name) {
  if (!state.robots.has(name)) state.robots.set(name, { name, phase: "idle", attempt: 0 });
  return state.robots.get(name);
}

export function apply(state, e) {
  const changed = new Set();
  if (e.take !== state.take) {
    Object.assign(state, createState(), { take: e.take });
  }
  const r = e.robot ? robot(state, e.robot) : null;
  const mark = (field) => changed.add(`${e.robot}:${field}`);
  switch (e.kind) {
    case "take": state.lessons = [...(e.lessons || [])]; break;
    case "attempt":
      Object.assign(r, { attempt: e.attempt, phase: "planning", plan: null, safety: null, result: null, lessonsFound: null });
      mark("phase");
      break;
    case "lessons": r.lessonsFound = e.lessons; mark("lessons"); break;
    case "plan": r.plan = e.plan; mark("plan"); break;
    case "phase": r.phase = e.phase; mark("phase"); break;
    case "safety": r.safety = e; mark("safety"); break;
    case "hold": r.phase = "frozen"; mark("phase"); break;
    case "escalate": r.phase = "needs a human"; mark("phase"); break;
    case "result": r.result = e; r.phase = "done"; mark("result"); mark("phase"); break;
    case "lesson":
      state.lessons.push(e.lesson);
      state.newIds.add(e.lesson.id);
      changed.add(`lesson:${e.lesson.id}`);
      break;
    case "error": if (r) { r.error = `${e.where}: ${e.error}`; mark("result"); } break;
    case "outcome": r.outcome = e.outcome; break;
    case "call":
      state.totalCalls += 1;
      state.calls.unshift(e);
      state.calls.length = Math.min(state.calls.length, MAX_CALLS);
      changed.add("calls");
      break;
  }
  return changed;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function renderRobot(r, changed) {
  const enter = (field) => (changed.has(`${r.name}:${field}`) ? " enter" : "");
  const lessons = r.lessonsFound == null ? "" : r.lessonsFound.length
    ? `<div class="found${enter("lessons")}">${r.lessonsFound.map((l) => `<span class="chip used">${esc(l.id)}</span>`).join("")}</div>`
    : `<span class="none${enter("lessons")}">none</span>`;
  const plan = r.plan
    ? `<div class="${enter("plan")}"><div class="plan">
        <span>tilt <b>${r.plan.tilt_speed}</b></span>
        <span>height <b>${r.plan.pour_height_cm} cm</b></span>
        <span>arm <b>${r.plan.arm_speed}</b></span>
        <span>angle <b>${r.plan.tilt_angle_deg}°</b></span>
      </div><div class="why">${esc(r.plan.justification)}</div></div>`
    : `<span class="none">…</span>`;
  const s = r.safety;
  const safety = s
    ? `<span class="badge ${s.status === "unsure" ? "unsure" : s.label}${enter("safety")}">${s.status === "unsure" ? "UNSURE" : LABELS[s.label]}</span>
       <div class="reason${enter("safety")}">${esc(s.reason)}</div>`
    : `<span class="none">…</span>`;
  const result = r.result
    ? `<span class="result ${r.result.success ? "ok" : "bad"}${enter("result")}">${r.result.success ? "✓" : "✗"} ${esc(r.result.reason)}</span>`
    : r.error ? `<span class="result bad${enter("result")}">${esc(r.error)}</span>` : `<span class="none">…</span>`;
  return `<article class="card">
    <div class="robot-head"><span class="robot-name">${esc(r.name)}</span>
      <span class="chip${enter("phase")}">${r.attempt ? `attempt ${r.attempt} · ` : ""}${esc(r.phase)}</span></div>
    <div class="row"><div class="key">Lessons</div><div>${lessons}</div></div>
    <div class="row"><div class="key">Plan</div><div>${plan}</div></div>
    <div class="row"><div class="key">Safety</div><div>${safety}</div></div>
    <div class="row"><div class="key">Result</div><div>${result}</div></div>
  </article>`;
}

export function render(state, root, changed = new Set()) {
  const slot = (name) => root.querySelector(`[data-slot="${name}"]`);
  slot("robots").innerHTML = [...state.robots.values()].map((r) => renderRobot(r, changed)).join("");
  slot("memory").innerHTML = state.lessons.length
    ? state.lessons.map((l) => `<li class="lesson${state.newIds.has(l.id) ? " fresh" : ""}${changed.has(`lesson:${l.id}`) ? " enter" : ""}">
        <span class="clamp">${esc(l.text)}</span><small>${esc(l.id)} · from ${esc(l.source_robot)}</small></li>`).join("")
    : `<li class="none">No lessons yet.</li>`;
  slot("calls").innerHTML = state.calls.length
    ? state.calls.map((c, i) => `<li class="${i === 0 && changed.has("calls") ? "enter" : ""}">
        <span><b>${esc(TASK_NAMES[c.task] || c.task)}</b> · ${esc(c.robot)}</span><span>${c.ms} ms</span></li>`).join("")
      + `<li><span>total this take</span><span>${state.totalCalls}</span></li>`
    : `<li class="none">None yet.</li>`;
}
