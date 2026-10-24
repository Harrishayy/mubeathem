/**
 * The one place @cue/ui touches @cue/core logic. Contracts and logic come from core; only the
 * formatting core doesn't need (cost, latency) lives here.
 */
export { mascotFor, formatDuration, formatPercent, formatMultiplier, truncateWords, type MascotState } from '@cue/core';

export const MASCOT_STATES = ['idle', 'listening', 'thinking', 'suggesting', 'warning', 'celebrating', 'learning', 'offline'] as const;

export type Connection = 'live' | 'reconnecting' | 'offline';

/** USD with sensible precision for tiny model costs. */
export function formatUsd(x: number): string {
  if (x === 0) return '$0';
  if (x < 0.01) return `$${x.toFixed(4)}`;
  return `$${x.toFixed(2)}`;
}

/** 1834 -> "1.8 s", 420 -> "420 ms". */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
