import type { OutcomeRecord, Prospect, Rep, Turn } from '@cue/core';

/** A finished call pulled from the system of record (Trellus, or Cue's own store when native). */
export interface ImportedCall {
  trellusSessionId: string;
  /** Epoch ms. */
  startedAt: number;
  durationMs: number;
  prospect: Prospect;
  rep: Rep;
  turns: Turn[];
  outcome: OutcomeRecord | null;
  /** Source columns verbatim (transcript arrays excluded; they are in `turns`). */
  raw: Record<string, unknown>;
}

export interface FindOutcomeQuery {
  /** Epoch ms when Cue saw the call start. */
  startedAt: number;
  endedAt?: number;
  prospect: Prospect;
}

/** Where outcomes and history come from. The server uses whichever is configured. */
export interface CallSource {
  kind: 'trellus' | 'native';
  /** `null` = no outcome yet (or none to find); poll again later. */
  findOutcome(q: FindOutcomeQuery): Promise<OutcomeRecord | null>;
  /** Newest first. `since` is epoch ms. */
  listRecent(q: { since: number; limit?: number }): Promise<ImportedCall[]>;
}
