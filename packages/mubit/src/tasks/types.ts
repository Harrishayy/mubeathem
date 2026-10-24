import type { TASK_OUTPUT, TaskId, TaskOutput } from '@cue/core';

/**
 * A Mubit task: fixed instructions + fixed output schema + fixed model tier. Mubit groups calls into a
 * task by exactly these (docs/mubit/llms-full.txt, "What makes a task"), so none of them may vary per
 * call. Everything call-specific travels in the user message as JSON.
 */
export interface TaskDef<K extends TaskId> {
  id: K;
  /** `fast` → config.models.fast, `write` → config.models.write, `live` → config.models.live. */
  tier: 'fast' | 'write' | 'live';
  /** Bump when the instructions or schema change: it is a new Mubit task from then on. */
  version: number;
  /** The system prompt. A constant: never interpolate anything call-specific into it. */
  instructions: string;
  output: (typeof TASK_OUTPUT)[K];
  maxOutputTokens: number;
  temperature: number;
  /** Clamps numbers into their documented ranges after parsing (strict mode can't carry bounds). */
  normalize?: (output: TaskOutput<K>) => TaskOutput<K>;
}

export const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
export const clamp11 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(-1, n)) : 0);
