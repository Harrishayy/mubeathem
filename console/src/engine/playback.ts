// The shared playhead. Lives outside every panel, so the replay keeps working
// whichever panels are on screen, and across tabs.

import { DECISION_KINDS } from "./timeline";
import type { Store } from "./store";

// How long the player rests on each decision, like the take player does.
const HOLD_MS: Record<string, number> = { plan: 1100, safety: 500, hold: 800, escalate: 1300, result: 1200, lesson: 1500 };

export const isResting = (store: Store) => store.state.playback.holdUntil > performance.now();

export function tickPlayback(store: Store, dt: number) {
  const st = store.state, s = st.selection, pb = st.playback;
  const r = s.robotId ? st.byId[s.robotId] : null;
  if (!r) return;
  if (s.live) {
    if (s.epId !== r.ep.id) { s.epId = r.ep.id; store.emit("select", s); }
    pb.t = st.simNow - r.ep.start;
    return;
  }
  const ep = s.epId ? st.episodes[s.epId] : null;
  if (!ep || !pb.playing) return;
  const now = performance.now();
  if (pb.holdUntil > now) return;
  const prev = pb.t;
  pb.t = Math.min(ep.duration, pb.t + dt * pb.rate);
  if (pb.pauseAt) {
    const hit = ep.events.find((e) => DECISION_KINDS.has(e.kind) && e.at > prev && e.at <= pb.t);
    if (hit) { pb.t = hit.at; pb.holdUntil = now + (HOLD_MS[hit.kind] || 600); }
  }
  if (pb.t >= ep.duration) { pb.playing = false; store.emit("playback", pb); }
}
