// The demo source: nine simulated robots on three tasks, run in the browser by
// src/engine/sim.ts. Needs no backend. Lessons and re-runs live only in this tab.

import { createSim } from "@/engine/sim";
import { importTake } from "@/engine/take";
import { pushLog } from "@/engine/state";
import { fmtP } from "@/engine/format";
import type { SourceDef } from "../types";

export const demo: SourceDef = {
  id: "demo",
  label: "Demo fleet",
  short: "Demo",
  about: "Nine simulated robots on pour, pick and stack, run in the browser. Nothing here is a real run.",
  caps: ["sim", "samples", "adapters", "rerun"],
  async start(store) {
    const st = store.state, emit = (e: string, p?: unknown) => store.emit(e, p);
    const sim = createSim(store);
    sim.prefill();
    return {
      tick(dt) { if (st.running) sim.tick(dt * st.speed); },
      stop() {},
      ops: {
        async addLesson(l) {
          const id = `lesson-${++st.lessonSeq}`;
          const lesson = { ...l, id, source_robot: "operator", uses: 0, successes: 0, created_abs: st.simNow, revisions: 0 };
          st.lessons.push(lesson);
          pushLog(st, { abs: st.simNow, robot: "operator", kind: "lesson", data: { at: 0, kind: "lesson", robot: "operator", lesson: { ...lesson }, revised: false }, epId: null }, emit);
          return id;
        },
        async retireLesson(l) { l.retired = !l.retired; },
        async rerun(ep, fix) {
          const r = st.byId[ep.robot];
          r.queued = { variant: ep.variant, override: { [fix.param]: fix.value } };
          return `${r.name} runs “${ep.variant.subject}” next with ${fix.param} ${fmtP(fix.param, fix.value)}.`;
        },
        async openTake(text, fileName) {
          const res = importTake(store, text, fileName);
          const r = res.robots[0];
          return { robotId: r.id, epId: r.history[0].id, summary: `Opened take ${res.take}: ${res.events} events from ${res.robots.length} robot${res.robots.length > 1 ? "s" : ""}.` };
        },
      },
    };
  },
};
