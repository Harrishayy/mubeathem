import { reduceCall, type CallEvent, type CallView } from '@cue/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { galleryEvents } from '../src/fixtures/views';

export interface Playback {
  view: CallView | null;
  playing: boolean;
  done: boolean;
  /** 0..1 */
  progress: number;
  voiceLevel: number;
  /** The replay's clock (epoch ms in the call's own time), for CallTimer at 2× / 4×. */
  now: number;
  speed: number;
  variant: 'cold' | 'warm';
  play: () => void;
  pause: () => void;
  restart: () => void;
  setSpeed: (s: number) => void;
  setVariant: (v: 'cold' | 'warm') => void;
}

/**
 * Replays core's demo call through the real reducer at real speed (or faster): the same events the
 * server would stream, applied one at a time. Simulates the prospect's voice level while they talk.
 */
export function useDemoPlayback(autoplay = false): Playback {
  const [variant, setVariant] = useState<'cold' | 'warm'>('cold');
  const [speed, setSpeed] = useState(1);
  const [events, setEvents] = useState<CallEvent[]>(() => galleryEvents('cold', Date.now()));
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [voice, setVoice] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now, setNow] = useState(() => events[0]?.at ?? Date.now());
  const stepWall = useRef(Date.now());

  const view = i === 0 ? null : reduceCall(events.slice(0, i));
  const done = i >= events.length;

  useEffect(() => {
    if (!playing || done) return;
    const prev = events[i - 1];
    const next = events[i]!;
    const wait = prev ? Math.max(0, (next.at - prev.at) / speed) : 300;
    timer.current = setTimeout(() => setI((n) => n + 1), Math.min(wait, 6000 / speed));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, i, events, speed, done]);

  useEffect(() => {
    if (done) setPlaying(false);
  }, [done]);

  // Call-time clock: the last applied event's time plus wall time since, scaled by speed.
  useEffect(() => {
    stepWall.current = Date.now();
    const base = events[Math.max(0, i - 1)]?.at ?? Date.now();
    setNow(base);
    if (!playing) return;
    const cap = events[i]?.at ?? base;
    const id = setInterval(() => setNow(Math.min(cap, base + (Date.now() - stepWall.current) * speed)), 200);
    return () => clearInterval(id);
  }, [i, playing, speed, events]);

  // Voice level: the prospect is "speaking" from the start of their turn until it is final.
  const speaking = (() => {
    if (!view || !playing) return false;
    const next = events[i];
    return next?.type === 'turn.added' && next.turn.speaker === 'prospect';
  })();
  useEffect(() => {
    if (!speaking) {
      setVoice(0);
      return;
    }
    let raf = 0;
    let t = 0;
    const tick = () => {
      t += 1;
      setVoice(Math.max(0, Math.min(1, 0.45 + 0.35 * Math.sin(t / 3.1) * Math.sin(t / 7.3) + (Math.random() - 0.5) * 0.25)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  const restart = useCallback(() => {
    setEvents(galleryEvents(variant, Date.now()));
    setI(0);
    setPlaying(true);
  }, [variant]);

  return {
    view,
    playing,
    done,
    progress: events.length ? i / events.length : 0,
    voiceLevel: voice,
    now,
    speed,
    variant,
    play: () => {
      if (done) restart();
      else {
        if (i === 0) setEvents(galleryEvents(variant, Date.now()));
        setPlaying(true);
      }
    },
    pause: () => setPlaying(false),
    restart,
    setSpeed,
    setVariant: (v) => {
      setVariant(v);
      setEvents(galleryEvents(v, Date.now()));
      setI(0);
      setPlaying(false);
    },
  };
}
