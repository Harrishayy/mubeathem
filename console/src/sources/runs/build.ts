// Steward's takes → engine state. Everything the panels show is built here, from the lines
// Steward logged (steward/EVENTS.md) and the lesson files, and nothing else.
//
// An episode is one attempt by one robot: its `attempt` line up to that robot's next one.
// Its times (`at`) are seconds from the attempt's start: on the take's video when it has
// one (the sim paused during each model call, so decisions sit between frames), else on
// the wall clock, where the wait for each answer shows as a shaded segment.

import { EPOCH } from "@/engine/format";
import { specOf } from "@/engine/task";
import { isSapling } from "@/engine/calls";
import { povUrl, videoUrl } from "@/services/runs/client";
import type { CallRef, Episode, Lesson, LessonRef, Manifest, MubitTask, Outcome, Robot, Seg, SEvent, Settings, TaskKey, TaskSpec } from "@/engine/types";
import type { LessonFile, RawEvent, TakeDetail, TakeSummary } from "@/services/types";

/** Steward's one task. Its phases, ranges and policy come from the takes (engine/task.ts). */
export const TASK: TaskKey = "pour";

/** A finished attempt ends this long after its last line, so the replay can rest on the result. */
const TAIL = 0.7;
const RECENT_CALLS = 30;
const STOP_WORDS = new Set(["a", "an", "the", "of", "into", "in", "to", "and", "with", "from", "on", "at", "cm", "mm", "across", "pieces", "pouring", "pour"]);

export interface Built {
  robots: Robot[]; byId: Record<string, Robot>; episodes: Record<string, Episode>; done: Episode[];
  calls: CallRef[]; mubit: Record<string, MubitTask>; manifests: Record<string, Manifest>; spec: TaskSpec; takes: TakeSummary[];
  /** Where each logged line landed: its episode, and its time there. */
  places: Map<RawEvent, { epId: string; at: number; ev: SEvent }>;
}

/** Words of the subject a lesson can match on, in order (steward/lessons.py matches whole words). */
function appliesOf(subject: string): string[] {
  return [...new Set(String(subject).toLowerCase().match(/[a-z]+/g) || [])].filter((w) => !STOP_WORDS.has(w));
}

/** The plan settings a lesson names with a value ("arm_speed to 0.35"). */
export function settingsIn(text: string, keys: string[]): Settings {
  const out: Settings = {};
  for (const k of keys) {
    const m = new RegExp(`${k}\\s*(?:to|of|at|=|:|→)?\\s*(-?\\d+(?:\\.\\d+)?)`).exec(text);
    if (m) out[k] = Number(m[1]);
  }
  return out;
}

interface Draft { take: TakeSummary; robot: string; k: number; raw: RawEvent[] }

/** Each robot's attempts in one take, with the lines that belong to them. */
function drafts(d: TakeDetail): Draft[] {
  const out: Draft[] = [], cur = new Map<string, Draft>(), count = new Map<string, number>();
  for (const e of d.events) {
    if (typeof e.robot !== "string") continue;
    if (e.kind === "attempt") {
      const k = (count.get(e.robot) || 0) + 1;
      count.set(e.robot, k);
      const dr = { take: d.summary, robot: e.robot, k, raw: [e] };
      cur.set(e.robot, dr);
      out.push(dr);
    } else cur.get(e.robot)?.raw.push(e);
  }
  return out;
}

function episodeOf(d: Draft, next: Draft | undefined, sourceOf: (take: TakeSummary, id: string) => string): Episode | null {
  const sum = d.take, first = d.raw[0];
  const onVideo = !!sum.video && typeof first.vt === "number";
  const t0 = onVideo ? first.vt! : first.t;
  const events: SEvent[] = d.raw.map((e) => ({ ...e, robot: d.robot, at: Math.max(0, (onVideo ? e.vt ?? first.vt! : e.t) - t0) }));
  const find = (kind: string) => events.find((e) => e.kind === kind);
  const result = find("result"), plan = find("plan"), recalled = find("lessons"), written = find("lesson");
  const stop = events.find((e) => e.kind === "escalate" || e.kind === "error");

  const outcome: Outcome = result ? (result.success ? "success" : "failed") : find("outcome") || next ? "stopped" : "";
  // An attempt the take never finished (the run was killed) has no outcome to show.
  if (!outcome && !sum.live) return null;

  const settings: Settings = {};
  let justification = "";
  for (const [k, v] of Object.entries(plan?.plan || {})) {
    if (typeof v === "number") settings[k] = v;
    else if (k === "justification") justification = String(v);
  }
  // The scene as the planner saw it: the plan call's user message (tasks.plan_message).
  const user = events.find((e) => e.kind === "call" && e.task === "plan")?.sent?.user;
  const scene = typeof user === "string" ? (/^Scene: ([\s\S]*?)(?:\nFleet lessons:|$)/.exec(user)?.[1] || "").trim() : "";
  const lessons: LessonRef[] = (Array.isArray(recalled?.lessons) ? recalled.lessons : []).map((l: { id: string; text: string }) => ({
    id: String(l.id), text: String(l.text || ""), source: sourceOf(sum, String(l.id)), settings: {},
  }));

  const lastAt = events[events.length - 1].at;
  let duration = outcome ? lastAt + TAIL : lastAt;
  // On video, stop where the robot's next attempt starts, so the replay doesn't run into it.
  if (outcome && onVideo && typeof next?.raw[0].vt === "number") duration = Math.min(duration, Math.max(lastAt, next.raw[0].vt - t0));
  duration = Math.max(duration, 0.1);

  const reason = result ? String(result.reason || "")
    : stop ? String(stop.reason || (stop.error ? `The ${stop.where} call failed: ${stop.error}` : "")) : "";
  return {
    id: `${sum.id}:${d.robot}:${d.k}`, n: 0, robot: d.robot, task: TASK,
    variant: { subject: String(first.subject || ""), applies: appliesOf(first.subject || "") },
    start: first.t - EPOCH, take: sum.id, attempt: Number(first.attempt) || d.k,
    world: sum.mode === "isaac" ? "isaac" : "text",
    video: onVideo && sum.video ? {
      take: sum.id, src: videoUrl(sum.id), povSrc: !sum.video.prepared && sum.video.pov ? povUrl(sum.id) : null,
      prepared: sum.video.prepared, start: t0, end: t0 + duration, fps: sum.video.fps,
    } : null,
    scene, lessons, plan: settings, justification, success: !!result?.success, events, segs: [],
    reason, outcome, lessonWritten: written?.lesson?.id ?? null,
    holds: events.filter((e) => e.kind === "hold").length, duration, resultAt: result?.at,
  };
}

/** Waiting on a model call, holding, and moving through each phase. */
function segsOf(ep: Episode, phases: string[]): Seg[] {
  const ev = ep.events, segs: Seg[] = [];
  // When a call's wait began: on video, never (the sim was paused); on the wall clock, ms before its answer.
  const waitFrom = (i: number) => {
    const e = ev[i];
    if (e.kind !== "call" || ep.video) return e.at;
    return Math.max(i > 0 ? ev[i - 1].at : 0, e.at - (Number(e.ms) || 0) / 1000);
  };
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i], nextStart = i + 1 < ev.length ? waitFrom(i + 1) : ep.duration;
    if (e.kind === "call") {
      const t0 = waitFrom(i);
      if (e.at > t0) segs.push({ kind: "decide", t0, t1: e.at, task: e.task, via: e.via || "mubit" });
    } else if (e.kind === "hold") {
      segs.push({ kind: "hold", t0: e.at, t1: nextStart, phase: phases.indexOf(String(e.phase)) });
    } else if (e.kind === "safety" && e.label === "supported" && e.status === "decided") {
      // The gate said go: the robot runs the phase until the next line (the next phase, a recheck or the result).
      segs.push({ kind: "motion", t0: e.at, t1: nextStart, phase: phases.indexOf(String(e.phase)) });
    }
  }
  return segs.filter((s) => s.t1 > s.t0).sort((a, b) => a.t0 - b.t0);
}

const robotName = (id: string) => { const m = /^robot[-_ ]?(.+)$/i.exec(id); return m ? `Robot ${m[1]}` : id; };

export function build(details: TakeDetail[], files: LessonFile[]): Built {
  const takes = details.map((d) => d.summary).sort((a, b) => a.started - b.started);
  const ordered = [...details].sort((a, b) => a.summary.started - b.summary.started);

  const manifests: Record<string, Manifest> = {};
  for (const d of ordered) { const m = d.events.find((e) => e.kind === "take")?.steward; if (m) manifests[d.summary.id] = m; }

  // Who wrote a recalled lesson: the take's own lesson file, else the fleet file.
  const fileLessons = new Map(files.map((f) => [f.file, f.lessons]));
  const fleet = files.find((f) => f.shared)?.lessons || [];
  const sourceOf = (take: TakeSummary, id: string) =>
    ((take.lessonsFile && fileLessons.get(take.lessonsFile)) || fleet).find((l) => l.id === id)?.source_robot || "";

  const perTake = ordered.map((d) => ({ d, ds: drafts(d) }));
  const all: Episode[] = [];
  for (const { ds } of perTake) {
    ds.forEach((dr, i) => {
      const next = ds.slice(i + 1).find((x) => x.robot === dr.robot);
      const ep = episodeOf(dr, next, sourceOf);
      if (ep) all.push(ep);
    });
  }
  all.sort((a, b) => a.start - b.start);

  const spec = specOf(Object.values(manifests), all), keys = Object.keys(spec.params);
  for (const ep of all) {
    ep.segs = segsOf(ep, spec.phases);
    for (const l of ep.lessons) l.settings = settingsIn(l.text, keys);
  }

  const episodes: Record<string, Episode> = {}, places: Built["places"] = new Map();
  const byRobot = new Map<string, Episode[]>();
  for (const ep of all) {
    episodes[ep.id] = ep;
    const list = byRobot.get(ep.robot) || [];
    list.push(ep);
    ep.n = list.length;
    byRobot.set(ep.robot, list);
  }
  for (const { d, ds } of perTake) {
    for (const dr of ds) {
      const ep = episodes[`${d.summary.id}:${dr.robot}:${dr.k}`];
      if (ep) dr.raw.forEach((e, i) => places.set(e, { epId: ep.id, at: ep.events[i].at, ev: ep.events[i] }));
    }
  }

  const live = new Set(takes.filter((t) => t.live).map((t) => t.id));
  const robots: Robot[] = [...byRobot.entries()].map(([id, eps]) => {
    const ep = eps[eps.length - 1], take = takes.find((t) => t.id === ep.take);
    return {
      id, name: robotName(id), task: TASK, model: take?.model || "model not recorded", env: ep.world === "isaac" ? "Isaac Sim" : "practice world",
      history: eps.filter((e) => e.outcome), count: eps.length, lastEv: ep.events[ep.events.length - 1] || null, ep, live: live.has(ep.take),
    };
  });
  const byId = Object.fromEntries(robots.map((r) => [r.id, r]));
  const done = all.filter((e) => e.outcome);

  const calls: CallRef[] = [];
  for (const ep of all) ep.events.forEach((e, idx) => {
    if (e.kind === "call") calls.push({ epId: ep.id, idx, abs: (e.t ?? 0) - EPOCH, robot: ep.robot, task: e.task, via: e.via || "mubit", ms: Number(e.ms) || 0, error: e.error });
  });
  calls.sort((a, b) => a.abs - b.abs);

  // Mubit's tasks, from the calls that went through its gateway (Sapling checks aren't Mubit calls).
  const mubit: Record<string, MubitTask> = {};
  for (const c of calls) {
    if (isSapling(c.via) || c.via !== "mubit") continue;
    const m = (mubit[c.task] ||= { calls: 0, errors: 0, lat: [], recent: [] });
    const e = episodes[c.epId].events[c.idx];
    m.calls++;
    if (c.error) m.errors++; else m.lat.push(c.ms);
    m.recent.push({ abs: c.abs, robot: c.robot, task: c.task, ms: c.ms, request_id: String(e.request_id || ""), error: c.error });
    if (m.recent.length > RECENT_CALLS) m.recent.shift();
  }

  return { robots, byId, episodes, done, calls, mubit, manifests, spec, takes, places };
}

/** The lesson files, as fleet lessons. */
export function lessonsOf(files: LessonFile[], spec: TaskSpec): Lesson[] {
  const keys = Object.keys(spec.params);
  return files.flatMap((f) => f.lessons.map((l) => ({
    id: l.id, task: TASK, text: l.text, applies_to: l.applies_to, settings: settingsIn(l.text, keys), source_robot: l.source_robot,
    uses: l.uses, successes: l.successes, created_abs: l.created_at ? Date.parse(l.created_at) / 1000 - EPOCH : null,
    retired: !!l.retired, file: f.file, key: `${f.file}#${l.id}`, scope: f.scope,
  })));
}

