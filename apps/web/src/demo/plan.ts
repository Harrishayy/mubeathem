import { DEMO_SCRIPT, demoScript, wordCount, type DemoLine } from '@cue/core';
import type { DemoVariant } from '../state/settings';

/** Natural pacing: ~165 words a minute, a short beat between turns. */
export const MS_PER_WORD = 360;
export const MIN_SPEAK_MS = 900;
export const GAP_MS = 650;
/** How long a fresh card stays up before the rep "says" it. */
export const READ_MS = 2_400;
/** Give the pipeline this long to answer a prospect turn before moving on. */
export const CARD_TIMEOUT_MS = 9_000;

export interface DemoStep {
  index: number;
  line: DemoLine;
  /** Pause before the speaker starts. */
  gapMs: number;
  /** How long the line takes to say. */
  speakMs: number;
  /** Post a partial at the halfway mark (long lines stream in, like a live transcriber). */
  interim: string | null;
  /** Prospect turns wait for their card, then leave it up to be read. */
  waitForCard: boolean;
}

export function demoLines(variant: DemoVariant): DemoLine[] {
  return variant === 'both' ? DEMO_SCRIPT : demoScript(variant);
}

/** The demo as timed steps. `speed` 2 plays twice as fast. Pure, so tests can pin the timing. */
export function planDemo(variant: DemoVariant, speed = 1): DemoStep[] {
  const k = 1 / Math.max(0.25, Math.min(4, speed));
  const lines = demoLines(variant);
  return lines.map((line, index) => {
    const words = wordCount(line.text);
    const prev = lines[index - 1];
    // The prospect replies a touch faster than the rep, who is reading the card.
    const gap = !prev ? 400 : prev.speaker === line.speaker ? GAP_MS * 1.6 : GAP_MS;
    return {
      index,
      line,
      gapMs: Math.round(gap * k),
      speakMs: Math.round(Math.max(MIN_SPEAK_MS, words * MS_PER_WORD) * k),
      interim: words >= 8 ? line.text.split(/\s+/).slice(0, Math.ceil(words / 2)).join(' ') : null,
      waitForCard: line.speaker === 'prospect',
    };
  });
}

/** Total runtime at a speed, ignoring the server's own latency. */
export function demoDurationMs(steps: DemoStep[], speed = 1): number {
  const k = 1 / Math.max(0.25, Math.min(4, speed));
  return steps.reduce((t, s) => t + s.gapMs + s.speakMs + (s.waitForCard ? Math.round(READ_MS * k) : 0), 0);
}
