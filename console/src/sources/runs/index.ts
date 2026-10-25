// Steward's real runs: every take in the runs dir, built into engine state (build.ts) and
// kept current. runs/latest.jsonl (the live service) says when a run writes a line, and the
// take list is polled too, so takes copied in with video/pull.sh appear without a reload.

import { EPOCH } from "@/engine/format";
import { pushLog } from "@/engine/state";
import { follow } from "@/services/live/client";
import { addLesson, listLessons, retireLesson } from "@/services/lessons/client";
import { getTake, listTakes } from "@/services/runs/client";
import type { LessonFile, RawEvent, RunsList, TakeDetail, TakeSummary } from "@/services/types";
import type { SourceDef } from "../types";
import { build, lessonsOf, type Built } from "./build";

const POLL_MS = 4000;
const LIVE_DEBOUNCE_MS = 300;

/** A take needs fetching again when anything its summary reports has moved. */
const changed = (a: TakeSummary, b: TakeSummary) =>
  a.events !== b.events || a.bytes !== b.bytes || a.live !== b.live || !!a.video !== !!b.video || a.lessonsFile !== b.lessonsFile;

export const runs: SourceDef = {
  id: "runs",
  label: "Steward runs",
  short: "Runs",
  about: "Every real take in the runs dir, with its video, followed live while a run writes.",
  caps: ["payloads", "video", "takes", "lessons-write", "practice"],

  async start(store) {
    const st = store.state, emit = (evt: string, p?: unknown) => store.emit(evt, p);
    const details = new Map<string, TakeDetail>();
    const logged = new Map<string, number>(); // lines of each take already in the event log
    const seenDone = new Set<string>();
    let files: LessonFile[] = [], filesSig = "", list: RunsList | null = null;

    async function loadLessons(): Promise<boolean> {
      try {
        const next = (await listLessons()).files, sig = JSON.stringify(next);
        if (sig === filesSig) return false;
        files = next; filesSig = sig;
        return true;
      } catch { return false; }
    }

    function note(): string | undefined {
      if (!list) return undefined;
      if (!list.exists) return `${list.dir} doesn't exist. Set STEWARD_RUNS_DIR to Steward's runs dir.`;
      if (!list.takes.length) return `No takes in ${list.dir} yet. Pull Isaac takes with video/pull.sh, or start a practice run.`;
      return undefined;
    }

    /** Rebuild the state from every take, then add the lines the event log hasn't shown yet. */
    function apply(first: boolean) {
      const b: Built = build([...details.values()], files);
      Object.assign(st, { robots: b.robots, byId: b.byId, episodes: b.episodes, done: b.done, calls: b.calls, mubit: b.mubit, manifests: b.manifests, spec: b.spec, takes: b.takes });
      st.lessons = lessonsOf(files, st.spec);

      const fresh: RawEvent[] = [];
      for (const [id, d] of details) {
        fresh.push(...d.events.slice(logged.get(id) || 0));
        logged.set(id, d.events.length);
      }
      fresh.sort((x, y) => x.t - y.t);
      for (const e of fresh) {
        const at = b.places.get(e);
        pushLog(st, { abs: e.t - EPOCH, robot: e.robot || "steward", kind: e.kind, data: at?.ev ?? { ...e, robot: e.robot || "steward", at: 0 }, epId: at?.epId ?? null, at: at?.at, raw: e }, emit);
      }

      for (const ep of st.done) {
        if (seenDone.has(ep.id)) continue;
        seenDone.add(ep.id);
        if (!first) emit("episode:done", { ep, robot: st.byId[ep.robot] });
      }
      // Keep the replay on a robot that still exists.
      if (st.selection.robotId && !st.byId[st.selection.robotId]) Object.assign(st.selection, { robotId: null, epId: null, live: false });

      Object.assign(st.source, { connected: true, live: b.takes.some((t) => t.live), note: note() });
      if (!first) { emit("robots"); emit("mubit"); emit("lessons"); emit("source"); emit("select", st.selection); }
    }

    let busy = false, again = false;
    async function refresh(first = false) {
      if (busy) { again = true; return; }
      busy = true;
      try {
        list = await listTakes();
        const want = list.takes.filter((s) => { const d = details.get(s.id); return !d || changed(d.summary, s); });
        const gone = [...details.keys()].filter((id) => !list!.takes.some((s) => s.id === id));
        const got = await Promise.all(want.map((s) => getTake(s.id).catch(() => null)));
        for (const id of gone) { details.delete(id); logged.delete(id); }
        for (const d of got) if (d) details.set(d.summary.id, d);
        const lessonsMoved = await loadLessons();
        if (first || want.length || gone.length) apply(first);
        else if (lessonsMoved) { st.lessons = lessonsOf(files, st.spec); emit("lessons"); }
        if (!st.source.connected) { st.source.connected = true; emit("source"); }
      } catch (err) {
        if (first) throw err;
        if (st.source.connected) { st.source.connected = false; emit("source"); }
      } finally {
        busy = false;
        if (again) { again = false; void refresh(); }
      }
    }

    await refresh(true);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (!debounce) debounce = setTimeout(() => { debounce = null; void refresh(); }, LIVE_DEBOUNCE_MS); };
    const unfollow = follow({
      line(e, n) { const d = details.get(e.take); if (!d || n >= d.events.length) soon(); },
      reset: soon,
    });
    const poll = setInterval(() => void refresh(), POLL_MS);

    async function reloadLessons() {
      await loadLessons();
      st.lessons = lessonsOf(files, st.spec);
    }

    return {
      tick() {
        st.simNow = Date.now() / 1000 - EPOCH;
        // A live attempt grows on the wall clock until its next line arrives.
        for (const r of st.robots) if (r.live && !r.ep.outcome && !r.ep.video) r.ep.duration = Math.max(r.ep.duration, st.simNow - r.ep.start);
      },
      stop() {
        unfollow();
        clearInterval(poll);
        if (debounce) clearTimeout(debounce);
      },
      ops: {
        async addLesson(l) {
          const res = await addLesson({ text: l.text, applies_to: l.applies_to, source: "operator" });
          await reloadLessons();
          return res.lesson.id;
        },
        async retireLesson(l) {
          const res = await retireLesson(l.file, l.id, !l.retired);
          l.retired = !!res.lesson.retired;
          await reloadLessons();
        },
      },
    };
  },
};
