import { z } from 'zod';
import {
  Brief,
  CallSourceZ,
  EpochMs,
  Evidence,
  Id,
  MomentZ,
  OutcomeRecord,
  OutcomeZ,
  PlaybookLine,
  PolicyCheck,
  Prospect,
  Rep,
  RepFeedback,
  Situation,
  Speaker,
  Suggestion,
  SuggestionAction,
  Turn,
} from './domain';
import { CallEvent } from './events';
import { CallReview, TASK_IDS } from './tasks';

/**
 * HTTP contract between @cue/server and its clients (apps/web, apps/extension).
 * Every response is parsed against these on the client. architecture.md §5 lists the routes.
 */

export const CreateCallRequest = z.object({
  source: CallSourceZ.default('cue'),
  prospect: Prospect,
  rep: Rep,
  trellusSessionId: z.string().max(120).optional(),
  /** Practice mode: the simulated prospect's mood and objections. */
  practice: z.object({ mood: z.enum(['warm', 'neutral', 'cool', 'cold']), objections: z.array(z.string().max(120)).max(6) }).optional(),
});
export type CreateCallRequest = z.infer<typeof CreateCallRequest>;

export const AddTurnRequest = z.object({
  id: Id.optional(),
  speaker: Speaker,
  text: z.string().min(1).max(4000),
  tMs: z.number().int().nonnegative().optional(),
  durMs: z.number().int().nonnegative().optional(),
  final: z.boolean().default(true),
  via: z.string().max(40).default('typed'),
});
export type AddTurnRequest = z.infer<typeof AddTurnRequest>;

export const SuggestionActionRequest = z.object({ action: SuggestionAction, text: z.string().max(400).optional() });
export type SuggestionActionRequest = z.infer<typeof SuggestionActionRequest>;

export const EndCallRequest = z.object({ outcome: z.enum(['meeting_booked', 'follow_up', 'not_interested', 'gatekeeper_blocked', 'voicemail', 'no_answer', 'wrong_person', 'callback_requested', 'unknown']).optional() });
export type EndCallRequest = z.infer<typeof EndCallRequest>;

export const FeedbackRequest = RepFeedback.omit({ submittedAt: true });
export type FeedbackRequest = z.infer<typeof FeedbackRequest>;

export const CallStatus = z.enum(['live', 'ended', 'reviewing', 'reviewed']);
export type CallStatus = z.infer<typeof CallStatus>;

/** The UI's read model of one call. `reduceCall(events)` produces it; the server returns it. */
export const CallView = z.object({
  id: Id,
  status: CallStatus,
  source: CallSourceZ,
  startedAt: EpochMs,
  endedAt: EpochMs.nullable(),
  prospect: Prospect,
  rep: Rep,
  brief: Brief.nullable(),
  turns: z.array(Turn),
  /** Latest read of the moment; null before the prospect has spoken. */
  situation: Situation.nullable(),
  /** The one card on screen. Null when Cue is quiet. */
  current: Suggestion.nullable(),
  /** Every card shown this call, newest last, with the rep's latest action on each. */
  history: z.array(z.object({ suggestion: Suggestion, action: SuggestionAction.nullable() })),
  flags: z.array(PolicyCheck),
  receptivityTrend: z.array(z.object({ tMs: z.number(), score: z.number() })),
  outcome: OutcomeRecord.nullable(),
  feedback: RepFeedback.nullable(),
  review: CallReview.nullable(),
  /** The pipeline is working on a prospect turn right now (mascot "thinking"). */
  pending: z.boolean(),
  lastError: z.object({ stage: z.string(), message: z.string() }).nullable(),
  lastSeq: z.number().int(),
  /** `at` of the latest event applied: the view's own "now", so derived UI state stays pure. */
  updatedAt: EpochMs.optional(),
});
export type CallView = z.infer<typeof CallView>;

export const CallSummary = z.object({
  id: Id,
  status: CallStatus,
  source: CallSourceZ,
  startedAt: EpochMs,
  durationMs: z.number().int().nonnegative().nullable(),
  prospect: z.object({ name: z.string(), title: z.string(), company: z.string() }),
  outcome: z.string().nullable(),
  suggestions: z.number().int(),
  used: z.number().int(),
});
export type CallSummary = z.infer<typeof CallSummary>;

export const PlaybookResponse = z.object({
  lines: z.array(PlaybookLine),
  /** Ranked view per moment for the playbook screen. */
  leaderboard: z.array(z.object({ moment: MomentZ, lines: z.array(z.object({ lineId: Id, text: z.string(), evidence: Evidence })) })),
  updatedAt: EpochMs,
});
export type PlaybookResponse = z.infer<typeof PlaybookResponse>;

/** What has been sent to Mubit per task: the demo's "your model is growing" panel. */
export const TaskStats = z.object({
  task: z.enum(TASK_IDS),
  model: z.string(),
  calls: z.number().int(),
  ok: z.number().int(),
  failed: z.number().int(),
  /** Distinct sessions (phone calls) the task has seen. */
  sessions: z.number().int(),
  p50Ms: z.number(),
  p95Ms: z.number(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** Estimated USD at the model's list price. */
  costUsd: z.number(),
  /** Mubit trains a task's first adapter at 25 kept examples by default. */
  adapterThreshold: z.number().int(),
  lastRequestId: z.string().nullable(),
});
export type TaskStats = z.infer<typeof TaskStats>;

export const StatsResponse = z.object({
  tasks: z.array(TaskStats),
  calls: z.object({ total: z.number().int(), booked: z.number().int(), reviewed: z.number().int(), withFeedback: z.number().int() }),
  playbook: z.object({ active: z.number().int(), candidates: z.number().int() }),
});
export type StatsResponse = z.infer<typeof StatsResponse>;

export const HealthResponse = z.object({
  ok: z.boolean(),
  version: z.string(),
  mubit: z.object({ configured: z.boolean(), reachable: z.boolean().nullable(), models: z.object({ fast: z.string(), write: z.string() }) }),
  trellus: z.object({ configured: z.boolean(), reachable: z.boolean().nullable(), lastSyncAt: EpochMs.nullable() }),
  sapling: z.object({ configured: z.boolean() }),
  exa: z.object({ configured: z.boolean() }),
  store: z.object({ path: z.string(), calls: z.number().int() }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** SSE data payload. `event: view` (a full CallView snapshot, sent on connect) and `event: event` (one CallEvent); `id:` is the seq. */
export const StreamMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('view'), view: CallView }),
  z.object({ kind: z.literal('event'), event: CallEvent }),
]);
export type StreamMessage = z.infer<typeof StreamMessage>;

/** Uniform error body. */
export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });
export type ApiError = z.infer<typeof ApiError>;

/* ───────────── Added by ws04 (server): responses that had no schema yet. Additive only. ───────────── */

/** `POST /api/calls/:id/turns` → 202. `duplicate` when a final turn with that id was already stored. */
export const AddTurnResponse = z.object({ turnId: Id, duplicate: z.boolean().optional() });
export type AddTurnResponse = z.infer<typeof AddTurnResponse>;

/** `POST /api/calls/:id/practice/next`: the simulated prospect's reply, already added as a turn. */
export const PracticeNextResponse = z.object({ turn: Turn, ended: z.boolean(), booked: z.boolean() });
export type PracticeNextResponse = z.infer<typeof PracticeNextResponse>;

/** `GET /api/trellus/status`. The key itself is never returned. */
export const TrellusStatusResponse = z.object({
  configured: z.boolean(),
  source: z.enum(['trellus', 'native']),
  reachable: z.boolean().nullable(),
  lastSyncAt: EpochMs.nullable(),
  lastError: z.string().nullable(),
  teamId: z.string().nullable(),
});
export type TrellusStatusResponse = z.infer<typeof TrellusStatusResponse>;

/** `POST /api/trellus/sync`. */
export const TrellusSyncResponse = z.object({ source: z.enum(['trellus', 'native']), imported: z.number().int(), matched: z.number().int(), skipped: z.number().int() });
export type TrellusSyncResponse = z.infer<typeof TrellusSyncResponse>;

/** `POST /api/trellus/key` → TrellusStatusResponse. Stored server-side, never echoed. */
export const TrellusKeyRequest = z.object({ apiKey: z.string().min(1).max(400), teamId: z.string().max(120).optional() });
export type TrellusKeyRequest = z.infer<typeof TrellusKeyRequest>;

/** `POST /api/stt/token`: a short-lived speech-to-text credential for the browser. 404 `stt_not_configured` when unset. */
export const SttTokenResponse = z.object({ provider: z.literal('deepgram'), token: z.string().min(1), expiresAt: EpochMs });
export type SttTokenResponse = z.infer<typeof SttTokenResponse>;

/** `GET`/`PUT /api/trellus/dispositions`: the account's disposition vocabulary and how each maps to an Outcome. */
export const TrellusDispositionsResponse = z.object({
  source: z.enum(['trellus', 'native']),
  /** The account's exact disposition strings (Trellus /bootstrap), or Cue native's labels. */
  vocabulary: z.array(z.string()),
  /** Each vocabulary entry with the outcome Cue records and why. */
  learned: z.array(z.object({ raw: z.string(), outcome: OutcomeZ, via: z.enum(['default', 'keyword', 'override', 'unmapped']) })),
  /** The full map in use (defaults + learned + overrides). */
  map: z.record(z.string(), OutcomeZ),
  overrides: z.record(z.string(), OutcomeZ),
  /** Vocabulary entries that map to nothing yet; the settings screen asks about these. */
  unmapped: z.array(z.string()),
  /** Why the vocabulary could not be loaded (e.g. Trellus unreachable), else null. */
  error: z.string().nullable(),
});
export type TrellusDispositionsResponse = z.infer<typeof TrellusDispositionsResponse>;

/** `PUT /api/trellus/dispositions`: replaces the manual overrides (raw disposition string → Outcome). */
export const TrellusDispositionsRequest = z.object({ overrides: z.record(z.string().min(1).max(120), OutcomeZ) });
export type TrellusDispositionsRequest = z.infer<typeof TrellusDispositionsRequest>;
