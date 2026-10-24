import { OUTCOME_LABEL, type Outcome, type OutcomeRecord } from '@cue/core';
import { normalisePhone, phoneExtension } from './phone';
import type { CallSource, FindOutcomeQuery, ImportedCall } from './source';

export type NativeStore = (q: { since: number; limit: number }) => Promise<ImportedCall[]> | ImportedCall[];

/**
 * Cue as the system of record (no Trellus key). The rep's tap is the outcome, so `findOutcome`
 * returns null and the server keeps the rep's record; history comes from Cue's own store.
 */
export class NativeSource implements CallSource {
  readonly kind = 'native' as const;
  constructor(private readonly opts: { store: NativeStore; defaultLimit?: number }) {}

  async findOutcome(_q: FindOutcomeQuery): Promise<OutcomeRecord | null> {
    return null;
  }

  async listRecent(q: { since: number; limit?: number }): Promise<ImportedCall[]> {
    const limit = q.limit ?? this.opts.defaultLimit ?? 200;
    const calls = await this.opts.store({ since: q.since, limit });
    return calls
      .filter((c) => c.startedAt >= q.since)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }
}

export interface NativeDisposition {
  outcome: Outcome;
  label: string;
  /** Single-key shortcut in the end-of-call sheet. */
  key: string;
}

/** The dispositions Cue native offers, in the order the end-of-call sheet shows them. */
export const NATIVE_DISPOSITIONS: readonly NativeDisposition[] = (
  [
    ['meeting_booked', 'b'],
    ['follow_up', 'f'],
    ['callback_requested', 'c'],
    ['not_interested', 'n'],
    ['gatekeeper_blocked', 'g'],
    ['voicemail', 'v'],
    ['no_answer', 'a'],
    ['wrong_person', 'w'],
  ] as const
).map(([outcome, key]) => ({ outcome, label: OUTCOME_LABEL[outcome], key }));

/** A `tel:` link (RFC 3966) for the softphone / OS dialler. Throws on input with no usable number. */
export function dialLink(phone: string): string {
  const e164 = normalisePhone(phone);
  if (!e164) throw new RangeError('dialLink: not a phone number');
  const ext = phoneExtension(phone);
  return `tel:${e164}${ext ? `;ext=${ext}` : ''}`;
}
