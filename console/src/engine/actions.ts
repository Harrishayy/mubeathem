// Everything a panel can ask the console to do. Panels never change shared state
// directly; they call these, and these emit the events other panels listen to.
// Actions whose effect depends on the data source go through the source's ops
// (src/sources/types.ts); `can` says which of those this source offers.

import { clamp } from "./format";
import { DECISION_KINDS } from "./timeline";
import { selectedEpisode } from "./state";
import type { Store } from "./store";
import type { CallRef, Episode, Fix, Lesson } from "./types";
import type { NewLesson, SourceOps } from "@/sources/types";

export function createActions(store: Store, ops: SourceOps) {
  const st = store.state, sel = st.selection, pb = st.playback;
  const emit = (e: string, p?: unknown) => store.emit(e, p);
  const leaveLive = () => { if (sel.live) { sel.live = false; emit("playback", pb); } };

  const a = {
    /** Replay a robot's episode. epId "live" follows whatever it is running now. */
    select(robotId: string, epId: string = "live", opts: { t?: number; paused?: boolean } = {}) {
      const r = st.byId[robotId]; if (!r) return;
      const live = epId === "live" && !!r.live;
      const ep = live ? r.ep : st.episodes[epId] || r.history[r.history.length - 1] || r.ep;
      Object.assign(sel, { robotId, epId: ep.id, live });
      Object.assign(pb, { t: live ? st.simNow - ep.start : clamp(opts.t ?? 0, 0, ep.duration), playing: !live && opts.t == null && !opts.paused, holdUntil: 0 });
      emit("select", sel); emit("playback", pb);
    },
    selectDefault() {
      const fails = st.done.filter((e) => e.outcome === "failed");
      const ep = fails[fails.length - 1];
      if (ep) a.select(ep.robot, ep.id);
      else if (st.robots[0]) a.select(st.robots[0].id, "live");
    },
    /** Select, then switch to the Replay tab. */
    replay(robotId: string, epId: string = "live", opts: { t?: number; paused?: boolean } = {}) { a.select(robotId, epId, opts); a.go("replay"); },
    followLive() { if (sel.robotId) a.select(sel.robotId, "live"); },
    seek(t: number) {
      const ep = selectedEpisode(st); if (!ep) return;
      leaveLive();
      pb.t = clamp(t, 0, ep.duration); pb.playing = false; pb.holdUntil = 0;
      emit("seek", pb.t); emit("playback", pb);
    },
    togglePlay() {
      const ep = selectedEpisode(st); if (!ep) return;
      leaveLive();
      if (pb.t >= ep.duration - 0.01) pb.t = 0;
      pb.playing = !pb.playing; pb.holdUntil = 0;
      emit("playback", pb);
    },
    setRate(x: number) { pb.rate = x; emit("playback", pb); },
    setPauseAt(v: boolean) { pb.pauseAt = v; emit("playback", pb); },
    jumpDecision(dir: 1 | -1) {
      const ep = selectedEpisode(st); if (!ep) return;
      const ds = ep.events.filter((e) => DECISION_KINDS.has(e.kind)).map((e) => e.at);
      const t = dir > 0 ? ds.find((x) => x > pb.t + 0.02) : [...ds].reverse().find((x) => x < pb.t - 0.02);
      a.seek(t != null ? t : dir > 0 ? ep.duration : 0);
    },

    /** Which source-dependent actions are available. */
    can: { addLesson: !!ops.addLesson, retireLesson: !!ops.retireLesson, rerun: !!ops.rerun, openTake: !!ops.openTake },

    /** Add a lesson. Resolves to its id, or null if the source refused (a toast says why). */
    async addLesson(l: NewLesson, ep: Episode | null = null): Promise<string | null> {
      if (!ops.addLesson) return null;
      try { const id = await ops.addLesson(l, ep); emit("lessons"); return id; }
      catch (err) { a.toast(`Couldn't add the lesson: ${(err as Error).message}`); return null; }
    },
    async retireLesson(l: Lesson) {
      if (!ops.retireLesson) return;
      try { await ops.retireLesson(l); emit("lessons"); a.toast(l.retired ? `${l.id} retired. Robots stop recalling it.` : `${l.id} restored.`); }
      catch (err) { a.toast(`Couldn't change ${l.id}: ${(err as Error).message}`); }
    },
    async rerun(ep: Episode, fix: Fix): Promise<boolean> {
      if (!ops.rerun) return false;
      try { a.toast(await ops.rerun(ep, fix), "Watch", () => a.select(ep.robot, "live")); emit("fleet"); return true; }
      catch (err) { a.toast(`Couldn't start the re-run: ${(err as Error).message}`); return false; }
    },

    /** Show one model call in the call inspector. */
    selectCall(ref: CallRef | null) { st.callSel = ref; emit("callsel", ref); },
    /** Select the call at ep.events[idx], building its ref. */
    selectCallAt(ep: Episode, idx: number) {
      const e = ep.events[idx]; if (!e || e.kind !== "call") return;
      a.selectCall({ epId: ep.id, idx, abs: ep.start + e.at, robot: ep.robot, task: e.task, via: e.via || "mubit", ms: e.ms, error: e.error });
    },

    selectLog(seq: number | null) { st.logSel = seq; emit("logsel", seq); },

    async openTake(file: File) {
      if (!ops.openTake) return null;
      try {
        const res = await ops.openTake(await file.text(), file.name);
        emit("robots");
        a.toast(res.summary, "Replay it", () => a.replay(res.robotId, res.epId));
        return res;
      } catch (err) {
        a.toast(err instanceof Error ? err.message : "That file couldn't be read as a Steward take.");
        return null;
      }
    },

    go(tab: string) { emit("navigate", tab); },
    toast(msg: string, label?: string, run?: () => void) { emit("toast", { msg, label, run }); },
  };
  return a;
}
export type Actions = ReturnType<typeof createActions>;
