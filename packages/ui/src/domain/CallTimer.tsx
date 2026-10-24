import { useState } from 'react';
import { formatDuration } from '../lib/core';
import { useInterval } from '../lib/useInterval';

export interface CallTimerProps {
  startedAt: number;
  endedAt?: number | null;
  /** Clock override (epoch ms). When set the timer doesn't tick on its own: replays pass their clock. */
  now?: number;
  className?: string;
}

/** Elapsed call time, ticking each second until the call ends. Not a live region (no per-second noise). */
export function CallTimer({ startedAt, endedAt, now: clock, className }: CallTimerProps) {
  const [wall, setWall] = useState(() => Date.now());
  useInterval(() => setWall(Date.now()), endedAt || clock !== undefined ? null : 1000);
  const now = clock ?? wall;
  const ms = (endedAt ? (clock !== undefined ? Math.min(endedAt, clock) : endedAt) : now) - startedAt;
  const text = formatDuration(ms);
  return (
    <time className={['cue-timer', className].filter(Boolean).join(' ')} dateTime={`PT${Math.max(0, Math.floor(ms / 1000))}S`} aria-label={`Call time ${text}`}>
      {text}
    </time>
  );
}
