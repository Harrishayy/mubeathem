// The debrief assistant. Asks, in order: Claude (when the console runs as a Claude
// artifact with the `sample` capability), Mubit's gateway through the mubit service
// (/api/mubit/debrief), and finally answers from the episode's own log.

import { clamp, fmtP, roundP, median } from "./format";
import { taskOf, FAIL_PHASE } from "./world";
import { eventPlain } from "./text";
import { nameOf } from "./state";
import { nextAttempt, planDiff, settingSplits } from "./history";
import { topProbability } from "./calls";
import { mubitStatus, debrief } from "@/services/mubit/client";
import { ApiError } from "@/services/http";
import type { ChatItem, Episode, Fix, State } from "./types";

type Sample = (input: { role: string; content: string }[], opts: Record<string, unknown>) => Promise<{ text: string; truncated: boolean }>;
let sample: Sample | null = null;
let mubitReady: boolean | null = null;

/** Find out which answer source is available. Resolves "claude" | "mubit" | "log". */
export async function detectSource(): Promise<"claude" | "mubit" | "log"> {
  try {
    const w = window as unknown as { claude?: { use?: (n: string) => Promise<Sample | null> } };
    if (w.claude?.use) sample = await w.claude.use("sample");
  } catch { sample = null; }
  if (sample) return "claude";
  try { mubitReady = (await mubitStatus()).configured === true; } catch { mubitReady = false; }
  return mubitReady ? "mubit" : "log";
}

export function autoRead(st: State, ep: Episode) {
  const r = st.byId[ep.robot], task = taskOf(ep.task);
  if (!ep.outcome) return `${r.name} is still running this ${task.name.toLowerCase()}. Ask about any decision so far, or wait for the result.`;
  const used = ep.lessons.length ? `The plan applied ${ep.lessons.map((l) => `${l.id} from ${nameOf(st, l.source)}`).join(" and ")}.` : "No fleet lesson matched, so the plan stayed near the default settings.";
  if (ep.outcome === "failed") {
    const ph = ep.failAt != null ? phaseAt(ep, ep.failAt) || task.phases[FAIL_PHASE[ep.task]] : null;
    return `Failed${ep.failAt != null ? ` at ${ep.failAt.toFixed(1)} s, during ${ph}` : ""}. ${ep.reason} ${used}${ep.lessonWritten ? ` Steward wrote ${ep.lessonWritten} from this failure.` : ""}`;
  }
  if (ep.outcome === "stopped") {
    const e = ep.events.find((x) => x.kind === "escalate");
    return `Stopped at ${e ? e.at.toFixed(1) : "?"} s. ${e ? e.reason : ep.reason} Steward fails closed, so the robot waited for an operator instead of acting.`;
  }
  const hold = ep.segs.find((s) => s.kind === "hold");
  return `Succeeded. ${ep.reason} ${used}${hold && ep.person ? ` It held ${(hold.t1 - hold.t0).toFixed(1)} s at ${hold.t0.toFixed(1)} s while a person was ${ep.person.dist.toFixed(1)} m away.` : ""}`;
}
function phaseAt(ep: Episode, t: number) { let ph: string | null = null; for (const e of ep.events) { if (e.at > t) break; if (e.kind === "phase") ph = e.phase; } return ph; }

export function suggestions(ep: Episode) {
  if (!ep.outcome) return ["What has it decided so far?"];
  if (ep.outcome === "failed") return ["Why did it fail?", "What should change?", "Compare with the last success"];
  if (ep.outcome === "stopped") return ["Why did it stop?", "Was stopping the right call?"];
  return ep.holds ? ["What made this one work?", "Was the hold necessary?"] : ["What made this one work?"];
}

function context(st: State, ep: Episode) {
  const task = taskOf(ep.task), r = st.byId[ep.robot];
  const real = !!ep.world && ep.world !== "sim", manifest = ep.take ? st.manifests[ep.take] : undefined, nx = nextAttempt(st, ep);
  const same = st.done.filter((e) => e.task === ep.task && e.variant.subject === ep.variant.subject && e.outcome === "success").slice(-5);
  return {
    robot: r.name, model: r.model, task: task.name, subject: ep.variant.subject, outcome: ep.outcome || "running",
    reason: ep.reason, metric: { name: task.metric.name, value: ep.metric, limit: task.metric.limit, unit: task.metric.unit },
    plan: ep.plan, justification: ep.justification,
    world: ep.world || "sim", take: ep.take, attempt: ep.attempt, scene_as_described_to_the_planner: ep.scene || undefined,
    sampled_candidates: real ? undefined : ep.cands.map((c, i) => ({ n: i + 1, plan: c.plan, score: c.score, dropped_because: c.violation || undefined, picked: i === ep.chosen || undefined })),
    model_calls: real ? ep.events.filter((e) => e.kind === "call").map((e) => ({ at_s: e.at, task: e.task, via: e.via, ms: e.ms, request_id: e.request_id, error: e.error, returned: e.got, sapling_top_probability: topProbability(e) ?? undefined })) : undefined,
    next_attempt: nx ? { plan: nx.plan, outcome: nx.outcome || "running", reason: nx.reason, changed: planDiff(ep.plan, nx.plan, ep.task) } : undefined,
    lessons_recalled: ep.lessons, lesson_written: ep.lessonWritten,
    events: ep.events.filter((e) => e.kind !== "call").map((e) => ({ at_s: e.at, kind: e.kind, detail: eventPlain(e, ep.task) })),
    safety_policy: manifest?.policy ? manifest.policy.split("\n") : task.policy, param_ranges: manifest?.ranges || task.params,
    recent_successes_same_subject: same.map((e) => ({ robot: st.byId[e.robot].name, episode: e.n, plan: e.plan })),
    fleet_lessons_for_task: st.lessons.filter((l) => l.task === ep.task && !l.retired).map((l) => ({ id: l.id, text: l.text, applies_to: l.applies_to, uses: l.uses, successes: l.successes })),
  };
}

export function instructions(st: State, ep: Episode) {
  const task = taskOf(ep.task);
  const where = ep.world === "isaac" ? "a GR-1 humanoid in Isaac Sim (times are seconds into the take's video; the physics paused during each model call)" : ep.world === "text" ? "the text-only practice world (times are wall-clock seconds, so they include model latency)" : "the browser simulation";
  return `You are the debrief assistant in Steward, a console for a fleet of robots that learn tasks. This episode ran in ${where}. Every plan, safety check and lesson in the data was a model call (Mubit for plans and lessons; Banyan Sapling or a stand-in for safety checks). An operator is reviewing one episode and asking you about it.
Use only the episode data below. Answer in at most five short sentences of plain text, no headings or markdown. Cite moments by their time in seconds, like "at 6.4 s". Be concrete about settings and numbers.
If the operator asks for a fix, a change, or a lesson, end your reply with one line of this exact form (one setting only, a value inside its range, two or three lowercase applies_to words taken from the subject, and a one-sentence lesson naming the property that caused the failure):
FIX {"param":"<one of ${Object.keys(task.params).join(", ")}>","value":<number>,"applies_to":["word","word"],"lesson":"<sentence>"}
Never claim a change was applied; the operator decides.

EPISODE DATA:
${JSON.stringify(context(st, ep))}`;
}

export function parseFix(text: string, ep: Episode): Fix | null {
  const m = String(text).match(/FIX\s*(\{[\s\S]*\})\s*$/); if (!m) return null;
  try {
    const o = JSON.parse(m[1]), task = taskOf(ep.task);
    if (!(o.param in task.params)) return null;
    const [lo, hi] = task.params[o.param];
    const value = roundP(o.param, clamp(Number(o.value), lo, hi));
    if (Number.isNaN(value)) return null;
    const applies = (Array.isArray(o.applies_to) ? o.applies_to : []).map((w: unknown) => String(w).toLowerCase().trim()).filter((w: string) => /^[a-z]+$/.test(w)).slice(0, 4);
    return { param: o.param, value, applies_to: applies.length ? applies : ep.variant.applies.slice(0, 2), lesson: String(o.lesson || "").slice(0, 280), status: "open" };
  } catch { return null; }
}
export const stripFix = (text: string) => String(text || "").replace(/\n?\s*FIX\s*\{[\s\S]*$/, "").trim();

/** Answers from the episode log alone. */
export function localAnswer(st: State, ep: Episode, q: string): { text: string; fix?: Fix } {
  const s = q.toLowerCase(), task = taskOf(ep.task);
  const succ = st.done.filter((e) => e.task === ep.task && e.variant.subject === ep.variant.subject && e.outcome === "success");
  const w = ep.worst;
  if (/fix|change|should|lesson|try|improve|adjust|write/.test(s) && ep.outcome === "failed" && !w) {
    // Real runs: propose what actually worked, from the next attempt or from the fleet's record.
    const nx = nextAttempt(st, ep), worked = nx?.outcome === "success" ? planDiff(ep.plan, nx.plan, ep.task) : [];
    const split = settingSplits(st.done.filter((e) => e.task === ep.task), ep.task).find((x) => x.separated);
    const pick = worked.find((c) => c.k === split?.k) || worked[0];
    const k = pick?.k || split?.k;
    if (k && task.params[k]) {
      const v = roundP(k, pick ? pick.to : split!.okMedian), cur = ep.plan[k];
      const written = ep.events.find((e) => e.kind === "lesson")?.lesson;
      const fix: Fix = { param: k, value: v, applies_to: (written?.applies_to || ep.variant.applies).slice(0, 3), lesson: `For ${ep.variant.applies.join(" ")} contents, set ${k} to ${fmtP(k, v)}; ${fmtP(k, cur)} failed.`, status: "open" };
      return { fix, text: pick
        ? `The next attempt changed ${k} from ${fmtP(k, cur)} to ${fmtP(k, v)} and succeeded. ${written ? `Steward already wrote ${written.id} from this failure: “${written.text}”` : ""} The proposal below makes that a fleet lesson; nothing changes until you add it.`
        : `Across the fleet, failed plans used ${k} around ${fmtP(k, split!.failedMedian)} and successful ones around ${fmtP(k, split!.okMedian)}. Try ${fmtP(k, v)}. The proposal is below; nothing changes until you add it.` };
    }
  }
  if (/fix|change|should|lesson|try|improve|adjust|write/.test(s) && ep.outcome === "failed" && w && task.params[w.k]) {
    const k = w.k, [lo, hi] = task.params[k], cur = ep.plan[k];
    const vals = succ.slice(-6).map((e) => e.plan[k]);
    const med = median(vals);
    const v = roundP(k, med != null ? med : w.dir === "hi" ? cur - (cur - lo) * 0.4 : cur + (hi - cur) * 0.4);
    const fix: Fix = { param: k, value: v, applies_to: ep.variant.applies.slice(0, 2), lesson: `For ${ep.variant.phrase}, set ${k} to ${fmtP(k, v)}; ${fmtP(k, cur)} ${w.dir === "hi" ? "was too high" : "was too low"}.`, status: "open" };
    return { fix, text: `Change ${k} from ${fmtP(k, cur)} to ${fmtP(k, v)}. ${vals.length ? `The last ${vals.length} successful runs of this subject used a median of ${fmtP(k, med)}.` : `No robot has succeeded at this subject yet, so this moves ${k} ${w.dir === "hi" ? "down" : "up"} by about 40%.`} The proposal is below; nothing changes until you add it or re-run.` };
  }
  if (/compare|success|differ|last/.test(s)) {
    const last = succ.filter((e) => e.id !== ep.id).slice(-1)[0];
    if (!last) return { text: `No robot has succeeded at “${ep.variant.subject}” yet, so there is nothing to compare against.` };
    const diffs = Object.keys(task.params).filter((k) => ep.plan[k] !== last.plan[k]).map((k) => `${k} ${fmtP(k, ep.plan[k])} here vs ${fmtP(k, last.plan[k])}`);
    return { text: `The last success was ${st.byId[last.robot].name} #${last.n}. Differences: ${diffs.join("; ") || "none in the settings"}.${w ? ` The setting that matters most for this subject is ${w.k}.` : ""}` };
  }
  if (/safe|hold|person|stop|policy|escalat|verify|necessary|right call/.test(s)) {
    const hold = ep.segs.find((x) => x.kind === "hold"), esc = ep.events.find((e) => e.kind === "escalate");
    if (esc) return { text: `At ${esc.at.toFixed(1)} s the verifier answered unsure: ${esc.reason} Steward only moves on a verdict that is supported and decided, so it stopped and asked for an operator. That is the intended behaviour; acting on a guess here could break rule 3.` };
    if (hold && ep.person) return { text: `At ${hold.t0.toFixed(1)} s a person was ${ep.person.dist.toFixed(1)} m away and arm_speed was ${fmtP("arm_speed", ep.plan.arm_speed)}, which breaks rule 2 (0.2 or lower inside 2 m). The robot held ${(hold.t1 - hold.t0).toFixed(1)} s until they left, then a fresh check came back supported.` };
    return { text: "Every safety check in this episode came back supported; nobody entered the 2 m zone." };
  }
  if (/work|went well|good/.test(s) && ep.outcome === "success") {
    return { text: `${ep.reason} ${ep.lessons.length ? `It applied ${ep.lessons.map((l) => l.id).join(" and ")}, which set ${ep.lessons.map((l) => Object.entries(l.settings).map(([k, v]) => `${k} ${fmtP(k, v)}`).join(", ")).join("; ")}.` : "It used near-default settings, which suit this subject."}` };
  }
  return { text: autoRead(st, ep) + (ep.failAt != null ? ` Jump to ${ep.failAt.toFixed(1)} s to see the moment it went wrong.` : "") };
}

export interface Answer { text: string; fix?: Fix | null; note?: string; offline?: boolean; via: "claude" | "mubit" | "log" }

const HIDE = ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"];

/** Ask about `ep` given the conversation so far. Never rejects. */
export async function ask(st: State, ep: Episode, convo: ChatItem[], opts: { signal: AbortSignal; onText: (t: string) => void }): Promise<Answer> {
  const turns = convo.flatMap((it) => (it.role === "user" ? [{ role: "user", content: it.text }] : it.role === "assistant" && it.text && !it.offline ? [{ role: "assistant", content: it.text }] : []));
  const q = turns[turns.length - 1]?.content || "";
  const fallback = (note: string): Answer => ({ ...localAnswer(st, ep, q), offline: true, note, via: "log" });
  const system = instructions(st, ep);

  if (sample) {
    try {
      const res = await sample([{ role: "user", content: system }, ...turns], { modelTier: "quick", cache: false, signal: opts.signal, onText: ({ text }: { text: string }) => opts.onText(text) });
      return { text: res.text, fix: parseFix(res.text, ep), note: res.truncated ? "The answer was cut short. Ask for less at a time." : "", via: "claude" };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "cancelled") return { text: (e as { text?: string }).text || "", note: "Stopped.", via: "claude" };
      if (code && HIDE.includes(code)) sample = null;
      else return { text: (e as { text?: string }).text || "", note: "The answer was interrupted. Send the question again to retry.", via: "claude" };
    }
  }
  if (mubitReady) {
    try {
      const j = await debrief(system, turns, opts.signal);
      if (j.text.trim()) return { text: j.text, fix: parseFix(j.text, ep), via: "mubit", note: `${j.ms} ms · ${j.id || "no request id"}` };
      return fallback("Mubit returned an empty answer, so this reply is built from the episode log.");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return { text: "", note: "Stopped.", via: "mubit" };
      if (e instanceof ApiError) return fallback(e.status === 503 ? "MUBIT_API_KEY isn't set, so this reply is built from the episode log." : `Mubit didn't answer (${e.body.status || e.status}), so this reply is built from the episode log.`);
      return fallback("Couldn't reach the debrief service, so this reply is built from the episode log.");
    }
  }
  await new Promise((res) => setTimeout(res, 300));
  return { ...localAnswer(st, ep, q), offline: true, via: "log" };
}
