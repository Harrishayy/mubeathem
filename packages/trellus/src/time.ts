/**
 * Trellus mixes units: request `start`/`end` are Unix **microseconds**; `started_at` in rows and
 * filters, durations and transcript offsets are **seconds**. Cue uses epoch milliseconds everywhere.
 */
export const msToMicros = (ms: number): number => Math.round(ms) * 1000;
export const microsToMs = (us: number): number => Math.floor(us / 1000);
export const secondsToMs = (s: number): number => Math.round(s * 1000);
export const msToSeconds = (ms: number): number => Math.floor(ms / 1000);

/** Unix µs for 1973-03-03; anything smaller is almost certainly ms or seconds passed by mistake. */
export const MIN_PLAUSIBLE_MICROS = 1e14;
