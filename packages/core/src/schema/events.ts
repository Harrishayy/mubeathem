import { z } from 'zod';
import {
  Brief,
  CallSourceZ,
  EpochMs,
  Id,
  OutcomeRecord,
  PolicyCheck,
  Prospect,
  Rep,
  RepFeedback,
  Situation,
  Suggestion,
  SuggestionAction,
  Turn,
  TurnFeatures,
} from './domain';
import { CallReview } from './tasks';

/**
 * A call is an append-only list of events. The UI, the store, the debrief and the record sent to
 * Mubit are all reductions of it (packages/core/src/call/reduce.ts). A new event type goes into this
 * union, the reducer, the mascot mapping and the CallRecord builder in the same change.
 */
const base = { callId: Id, at: EpochMs, seq: z.number().int().nonnegative() };

export const CallEvent = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('call.started'), source: CallSourceZ, prospect: Prospect, rep: Rep, trellusSessionId: z.string().max(120).optional() }),
  z.object({ ...base, type: z.literal('brief.ready'), brief: Brief }),
  /** Interim and final transcript turns. A final turn with an existing id replaces the interim one. */
  z.object({ ...base, type: z.literal('turn.added'), turn: Turn }),
  z.object({ ...base, type: z.literal('situation.read'), turnId: Id, situation: Situation, features: TurnFeatures, latencyMs: z.number().int().nonnegative(), servedBy: z.enum(['mubit', 'rules']), mubitRequestId: z.string().max(80).optional() }),
  z.object({ ...base, type: z.literal('suggestion.shown'), suggestion: Suggestion }),
  /** The pipeline chose not to show a card (quiet moment, low confidence, policy block). Logged so silence is explainable. */
  z.object({ ...base, type: z.literal('suggestion.skipped'), turnId: Id, reason: z.string().max(200) }),
  z.object({ ...base, type: z.literal('suggestion.action'), suggestionId: Id, action: SuggestionAction, text: z.string().max(400).optional() }),
  z.object({ ...base, type: z.literal('policy.checked'), check: PolicyCheck }),
  z.object({ ...base, type: z.literal('call.ended'), durationMs: z.number().int().nonnegative() }),
  z.object({ ...base, type: z.literal('outcome.recorded'), outcome: OutcomeRecord }),
  z.object({ ...base, type: z.literal('feedback.submitted'), feedback: RepFeedback }),
  z.object({ ...base, type: z.literal('review.completed'), review: CallReview, servedBy: z.enum(['mubit', 'rules']), mubitRequestId: z.string().max(80).optional() }),
  z.object({ ...base, type: z.literal('playbook.updated'), lineIds: z.array(Id), candidatesAdded: z.array(Id) }),
  /** Something failed but the call goes on. Never throw out of the pipeline; emit this. */
  z.object({ ...base, type: z.literal('pipeline.error'), stage: z.string().max(40), message: z.string().max(500), retryable: z.boolean() }),
]);
export type CallEvent = z.infer<typeof CallEvent>;
export type CallEventType = CallEvent['type'];

/** Distributive Omit so each union member keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before the store stamps it with `seq` and `at`. */
export type CallEventInput = DistributiveOmit<CallEvent, 'seq' | 'at'> & { at?: number };
