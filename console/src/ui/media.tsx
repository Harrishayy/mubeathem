"use client";

// What an episode looks like, by where it came from:
//   <VideoStage>  an Isaac take's video, kept in step with the replay playhead
//   <VideoStill>  one frame of a take's video, for tiles and lists
//   <TextWorld>   no video (the text-only practice world, or an Isaac take recorded
//                 without --video): the scene as Steward described it
// <EpisodeView> picks one for you.

import { useRef } from "react";
import { useConsole, useFrame } from "@/console/hooks";
import { clamp } from "@/engine/format";
import { isResting } from "@/engine/playback";
import { eventIndexAt, currentPhase } from "@/engine/timeline";
import { callFor, viaLabel } from "@/engine/calls";
import { EventText } from "./status";
import type { Episode } from "@/engine/types";

/** The take's video for the selected episode. While playing, the video is the clock. */
export function VideoStage({ ep, label }: { ep: Episode; label?: string }) {
  const { st, store } = useConsole();
  const main = useRef<HTMLVideoElement>(null), pov = useRef<HTMLVideoElement>(null);
  const vid = ep.video!;
  useFrame(() => {
    const el = main.current;
    if (!el || el.readyState < 1) return;
    const pb = st.playback, t = clamp(pb.t, 0, ep.duration), target = Math.min(vid.start + t, (el.duration || Infinity) - 0.05);
    const playing = pb.playing && !st.selection.live && !isResting(store) && t < ep.duration;
    for (const x of [el, pov.current]) {
      if (!x || x.readyState < 1) continue;
      if (playing) {
        if (x.playbackRate !== pb.rate) x.playbackRate = pb.rate;
        if (x.paused) x.play().catch(() => {});
        if (Math.abs(x.currentTime - target) > 0.35) x.currentTime = target;
      } else {
        if (!x.paused) x.pause();
        if (!x.seeking && Math.abs(x.currentTime - target) > 0.6 / vid.fps) x.currentTime = target;
      }
    }
    if (playing && !el.paused && !el.seeking) pb.t = clamp(el.currentTime - vid.start, 0, ep.duration);
  });
  return (
    <>
      <video ref={main} className="vp-video" src={vid.src} muted playsInline preload="auto" aria-label={label || `Video of take ${vid.take}`} />
      {vid.povSrc && <video ref={pov} className="vp-pov" src={vid.povSrc} muted playsInline preload="auto" aria-label="The robot's head camera" />}
    </>
  );
}

/** A frame of the episode's video at `t` seconds into the episode (default: its result). */
export function VideoStill({ ep, t }: { ep: Episode; t?: number }) {
  const vid = ep.video!;
  const at = clamp(vid.start + (t ?? ep.resultAt ?? ep.duration - 0.3), 0, vid.end);
  return <video className="vp-video" src={`${vid.src}#t=${at.toFixed(2)}`} muted playsInline preload="metadata" aria-label={`Frame of take ${vid.take}`} />;
}

/** No pictures: show what Steward told the planner, and where the attempt is now. */
export function TextWorld({ ep, t, compact = false }: { ep: Episode; t: number; compact?: boolean }) {
  const { idx, now } = eventIndexAt(ep, t);
  const { st } = useConsole();
  const ph = currentPhase(ep, t), phases = st.spec.phases;
  const cur = now >= 0 ? ep.events[now] : null;
  const pending = idx >= 0 && ep.events[idx]?.kind !== "call" && idx === ep.events.length - 1 && !ep.outcome;
  const ci = now >= 0 ? callFor(ep, now) : -1, call = ci >= 0 ? ep.events[ci] : null;
  return (
    <div className={`textworld${compact ? " compact" : ""}`}>
      <div className="tw-eyebrow">{ep.world === "isaac" ? "Isaac take · no video recorded" : "Text-only practice world"}</div>
      <p className="tw-scene">{ep.scene || ep.variant.subject}</p>
      <div className="tw-phases">{phases.map((p) => <span key={p} className={p === ph ? "on" : phases.indexOf(p) < phases.indexOf(ph || "") ? "past" : ""}>{p}</span>)}</div>
      {cur && <p className="tw-now"><EventText e={cur} />{call && <span className="tw-via"> · {viaLabel(call.via)} {call.ms} ms</span>}</p>}
      {pending && <p className="tw-wait">Waiting on a model call…</p>}
    </div>
  );
}

/** The right picture for an episode: its take's video, else the text view. */
export function EpisodeView({ ep, t, minimal = false, still = false, label }: { ep: Episode; t: () => number; minimal?: boolean; still?: boolean; label?: string }) {
  if (ep.video) return still ? <VideoStill ep={ep} /> : <VideoStage ep={ep} label={label} />;
  return <TextWorld ep={ep} t={t()} compact={minimal} />;
}
