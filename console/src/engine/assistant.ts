// The debrief assistant. Asks Claude (when the console runs as a Claude artifact with the
// `sample` capability), else Mubit's gateway through the mubit service (/api/mubit/debrief).
// Every answer comes from a model; when neither is reachable the reply says so.

import { clamp, roundP } from "./format";
import { eventPlain } from "./text";
import { nextAttempt, planDiff } from "./history";
import { topProbability } from "./calls";
import { mubitStatus, debrief } from "@/services/mubit/client";
import { ApiError } from "@/services/http";
import type { ChatItem, Episode, Fix, State } from "./types";

type Sample = (input: { role: string; content: string }[], opts: Record<string, unknown>) => Promise<{ text: string; truncated: boolean }>;
let sample: Sample | null = null;
let mubitReady: boolean | null = null;

/** Find out which answer source is available. Resolves "claude" | "mubit" | "log". */
export async function detectSource(): Promise<"claude" | "mubit" | "none"> {
  try {
    const w = window as unknown as { claude?: { use?: (n: string) => Promise<Sample | null> } };
    if (w.claude?.use) sample = await w.claude.use("sample");
  } catch { sample = null; }
  if (sample) return "claude";
  try { mubitReady = (await mubitStatus()).configured === true; } catch { mubitReady = false; }
  return mubitReady ? "mubit" : "none";
}

export function autoRead(st: State, ep: Episode) {
  const r = st.byId[ep.robot];
  if (!ep.outcome) return `${r.name} is still on this attempt. Ask about any decision so far, or wait for the result.`;
  const used = ep.lessons.length ? `The plan recalled ${ep.lessons.map((l) => l.id).join(" and ")}.` : "No fleet lesson matched this subject.";
  if (ep.outcome === "failed") {
    const at = ep.resultAt != null ? ` at ${ep.resultAt.toFixed(1)} s` : "", ph = ep.resultAt != null ? phaseAt(ep, ep.resultAt) : null;
    return `Failed${at}${ph ? `, after the ${ph} phase` : ""}. ${ep.reason} ${used}${ep.lessonWritten ? ` Steward wrote ${ep.lessonWritten} from this failure.` : ""}`;
  }
  if (ep.outcome === "stopped") {
    const e = ep.events.find((x) => x.kind === "escalate");
    return `Stopped${e ? ` at ${e.at.toFixed(1)} s` : ""}. ${e ? e.reason : ep.reason} Steward fails closed, so the robot waited for an operator instead of acting.`;
  }
  const hold = ep.segs.find((x) => x.kind === "hold");
  return `Succeeded. ${ep.reason} ${used}${hold ? ` It held ${(hold.t1 - hold.t0).toFixed(1)} s at ${hold.t0.toFixed(1)} s until a fresh check came back supported.` : ""}`;
}
function phaseAt(ep: Episode, t: number) { let ph: string | null = null; for (const e of ep.events) { if (e.at > t) break; if (e.kind === "phase") ph = e.phase; } return ph; }

export function suggestions(ep: Episode) {
  if (!ep.outcome) return ["What has it decided so far?"];
  if (ep.outcome === "failed") return ["Why did it fail?", "What should change?", "Compare with the last success"];
  if (ep.outcome === "stopped") return ["Why did it stop?", "Was stopping the right call?"];
  return ep.holds ? ["What made this one work?", "Was the hold necessary?"] : ["What made this one work?"];
}

function context(st: State, ep: Episode) {
  const r = st.byId[ep.robot], spec = st.spec;
  const manifest = st.manifests[ep.take], nx = nextAttempt(st, ep);
  const same = st.done.filter((e) => e.variant.subject === ep.variant.subject && e.outcome === "success").slice(-5);
  return {
    robot: r.name, model: r.model, task: ep.task, subject: ep.variant.subject, outcome: ep.outcome || "running",
    reason: ep.reason, plan: ep.plan, justification: ep.justification,
    world: ep.world, take: ep.take, attempt: ep.attempt, scene_as_described_to_the_planner: ep.scene || undefined,
    model_calls: ep.events.filter((e) => e.kind === "call").map((e) => ({ at_s: e.at, task: e.task, via: e.via, ms: e.ms, request_id: e.request_id, error: e.error, returned: e.got, sapling_top_probability: topProbability(e) ?? undefined })),
    next_attempt: nx ? { plan: nx.plan, outcome: nx.outcome || "running", reason: nx.reason, changed: planDiff(ep.plan, nx.plan) } : undefined,
    lessons_recalled: ep.lessons, lesson_written: ep.lessonWritten,
    events: ep.events.filter((e) => e.kind !== "call").map((e) => ({ at_s: e.at, kind: e.kind, detail: eventPlain(e) })),
    safety_policy: manifest?.policy ? manifest.policy.split("\n") : spec.policy, param_ranges: manifest?.ranges || spec.params,
    recent_successes_same_subject: same.map((e) => ({ robot: st.byId[e.robot].name, episode: e.n, plan: e.plan })),
    fleet_lessons: st.lessons.filter((l) => !l.retired).map((l) => ({ id: l.id, text: l.text, applies_to: l.applies_to, uses: l.uses, successes: l.successes })),
  };
}

export function instructions(st: State, ep: Episode) {
  const where = ep.world === "isaac" ? "a GR-1 humanoid in Isaac Sim (times are seconds into the take's video; the physics paused during each model call)" : "the text-only practice world (times are wall-clock seconds, so they include model latency)";
  return `You are the debrief assistant in Steward, a console for a fleet of robots that learn tasks. This episode ran in ${where}. Every plan, safety check and lesson in the data was a model call (Mubit for plans and lessons; Banyan Sapling or Mubit for safety checks). An operator is reviewing one episode and asking you about it.
Use only the episode data below. Answer in at most five short sentences of plain text, no headings or markdown. Cite moments by their time in seconds, like "at 6.4 s". Be concrete about settings and numbers.
If the operator asks for a fix, a change, or a lesson, end your reply with one line of this exact form (one setting only, a value inside its range, two or three lowercase applies_to words taken from the subject, and a one-sentence lesson naming the property that caused the failure):
FIX {"param":"<one of ${Object.keys(st.spec.params).join(", ")}>","value":<number>,"applies_to":["word","word"],"lesson":"<sentence>"}
Never claim a change was applied; the operator decides.

EPISODE DATA:
${JSON.stringify(context(st, ep))}`;
}

export function parseFix(text: string, st: State, ep: Episode): Fix | null {
  const m = String(text).match(/FIX\s*(\{[\s\S]*\})\s*$/); if (!m) return null;
  try {
    const o = JSON.parse(m[1]), range = st.spec.params[o.param];
    if (!range) return null;
    const value = roundP(o.param, clamp(Number(o.value), range[0], range[1]));
    if (Number.isNaN(value)) return null;
    const applies = (Array.isArray(o.applies_to) ? o.applies_to : []).map((w: unknown) => String(w).toLowerCase().trim()).filter((w: string) => /^[a-z]+$/.test(w)).slice(0, 4);
    return { param: o.param, value, applies_to: applies.length ? applies : ep.variant.applies.slice(0, 2), lesson: String(o.lesson || "").slice(0, 280), status: "open" };
  } catch { return null; }
}
export const stripFix = (text: string) => String(text || "").replace(/\n?\s*FIX\s*\{[\s\S]*$/, "").trim();

export interface Answer { text: string; fix?: Fix | null; note?: string; failed?: boolean; via: "claude" | "mubit" | "none" }

const HIDE = ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"];

/** Ask about `ep` given the conversation so far. Never rejects: a reply no model gave says so. */
export async function ask(st: State, ep: Episode, convo: ChatItem[], opts: { signal: AbortSignal; onText: (t: string) => void }): Promise<Answer> {
  const turns = convo.flatMap((it) => (it.role === "user" ? [{ role: "user", content: it.text }] : it.role === "assistant" && it.text && !it.failed ? [{ role: "assistant", content: it.text }] : []));
  const unanswered = (note: string): Answer => ({ text: "", failed: true, note, via: "none" });
  const system = instructions(st, ep);

  if (sample) {
    try {
      const res = await sample([{ role: "user", content: system }, ...turns], { modelTier: "quick", cache: false, signal: opts.signal, onText: ({ text }: { text: string }) => opts.onText(text) });
      return { text: res.text, fix: parseFix(res.text, st, ep), note: res.truncated ? "The answer was cut short. Ask for less at a time." : "", via: "claude" };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "cancelled") return { text: (e as { text?: string }).text || "", note: "Stopped.", via: "claude" };
      if (code && HIDE.includes(code)) sample = null;
      else return { text: (e as { text?: string }).text || "", note: "The answer was interrupted. Send the question again to retry.", via: "claude" };
    }
  }
  if (mubitReady === null) await detectSource();
  if (!mubitReady) return unanswered("No model to answer: set MUBIT_API_KEY in the repo's .env, then ask again.");
  try {
    const j = await debrief(system, turns, opts.signal);
    if (j.text.trim()) return { text: j.text, fix: parseFix(j.text, st, ep), via: "mubit", note: `${j.ms} ms · ${j.id || "no request id"}` };
    return unanswered("Mubit returned an empty answer. Ask again.");
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return { text: "", note: "Stopped.", via: "mubit" };
    if (e instanceof ApiError) return unanswered(e.status === 503 ? "MUBIT_API_KEY isn't set, so nothing can answer. Set it in the repo's .env." : `Mubit didn't answer (${e.body.status || e.status}). Ask again.`);
    return unanswered("Couldn't reach the debrief service. Check the console server is running.");
  }
}
