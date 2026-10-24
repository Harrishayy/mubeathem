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
  AttitudeZ,
  Situation,
  Speaker,
  Suggestion,
  SuggestionAction,
  Turn,
} from './domain';
import { CallEvent } from './events';
import { CallReview, SynthBriefInput, SynthBriefOutput, TASK_IDS } from './tasks';

/**
 * HTTP contract between @cue/server and its clients (apps/web, apps/extension).
 * Every response is parsed against these on the client. architecture.md §5 lists the routes.
 */

export const CreateCallRequest = z.object({
  source: CallSourceZ.default('cue'),
  prospect: Prospect,
  rep: Rep,
  trellusSessionId: z.string().max(120).optional(),
  /** The saved contact being called. The server fills `prospect` from it (request fields win) and stamps its last call. */
  contactId: Id.optional(),
  /** Practice mode: the simulated prospect's mood and objections. */
  practice: z.object({ mood: z.enum(['warm', 'neutral', 'cool', 'cold']), objections: z.array(z.string().max(120)).max(6) }).optional(),
  /** The client does its own research and sends it with `PUT /api/calls/:id/brief`; the server skips its own. */
  clientBrief: z.boolean().optional(),
});
export type CreateCallRequest = z.infer<typeof CreateCallRequest>;

export const PutBriefRequest = Brief;
export type PutBriefRequest = z.infer<typeof PutBriefRequest>;

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
  /** The saved contact this call was placed to, when started from one. */
  contactId: Id.nullable().optional(),
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
  /** Who made the call. */
  rep: z.object({ id: z.string(), name: z.string() }).optional(),
  contactId: z.string().nullable().optional(),
  /** The rep's debrief: 1..5 and the prospect's attitude. */
  rating: z.number().int().min(1).max(5).nullable().optional(),
  attitude: AttitudeZ.nullable().optional(),
  /** What went well and what didn't: the review's findings, then the rep's own words. */
  wentWell: z.array(z.string()).optional(),
  wentBadly: z.array(z.string()).optional(),
  /** Cue's one-paragraph review, once it's done. */
  reviewSummary: z.string().nullable().optional(),
});
export type CallSummary = z.infer<typeof CallSummary>;

/** Starts pre-call research for a contact or a typed prospect, so the brief is instant when the call starts. */
export const ResearchWarmRequest = z.object({ contactId: Id.optional(), prospect: Prospect.optional() }).refine((r) => r.contactId || r.prospect, 'contactId or prospect');
export type ResearchWarmRequest = z.input<typeof ResearchWarmRequest>;
export const ResearchWarmResponse = z.object({ configured: z.boolean(), providers: z.array(z.string()) });
export type ResearchWarmResponse = z.infer<typeof ResearchWarmResponse>;

/**
 * The brief before the call (POST /api/research/brief, same request as warm): what the call will open
 * with, cached per person so the call's own brief is the one the rep already read.
 */
export const ResearchBriefResponse = z.object({ brief: Brief, configured: z.boolean(), providers: z.array(z.string()) });
export type ResearchBriefResponse = z.infer<typeof ResearchBriefResponse>;

/** `POST /api/brief/synth`: the Corgi Brief panel's raw snippets → `synth_brief` through Mubit. */
export const SynthBriefRequest = SynthBriefInput;
export type SynthBriefRequest = z.infer<typeof SynthBriefRequest>;
export const SynthBriefResponse = z.object({ output: SynthBriefOutput, requestId: z.string().nullable(), model: z.string(), latencyMs: z.number() });
export type SynthBriefResponse = z.infer<typeof SynthBriefResponse>;

/** Filters for GET /api/calls. All optional; newest first. */
export const CallListQuery = z.object({
  repId: z.string().min(1).max(120).optional(),
  outcome: z.enum(['meeting_booked', 'follow_up', 'not_interested', 'gatekeeper_blocked', 'voicemail', 'no_answer', 'wrong_person', 'callback_requested', 'unknown', 'none']).optional(),
  status: z.enum(['live', 'ended', 'reviewing', 'reviewed']).optional(),
  /** Matches prospect name, title or company. */
  q: z.string().max(120).optional(),
  contactId: z.string().max(120).optional(),
  source: z.string().max(40).optional(),
  /** `1`: only calls the rep debriefed or Cue reviewed (the labelled ones). */
  debriefed: z.enum(['1', '0']).optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type CallListQuery = Partial<z.infer<typeof CallListQuery>>;

/** One member of the team, with their numbers. Derived from the calls they made. */
export const TeamMember = z.object({
  rep: z.object({ id: z.string(), name: z.string() }),
  calls: z.number().int(),
  connected: z.number().int(),
  booked: z.number().int(),
  bookingRate: z.number(),
  cuesShown: z.number().int(),
  cuesUsed: z.number().int(),
  avgRating: z.number().nullable(),
  /** Mean review score for how much the cues helped, 0..1. */
  avgImpact: z.number().nullable().optional(),
  /** Calls the rep debriefed (the labels that train Mubit). */
  debriefed: z.number().int().optional(),
  lastCallAt: EpochMs.nullable(),
  /** Oldest week first. */
  weekly: z.array(z.object({ weekStart: EpochMs, calls: z.number().int(), booked: z.number().int() })).optional(),
});
export type TeamMember = z.infer<typeof TeamMember>;
export const TeamTotals = z.object({
  reps: z.number().int(),
  calls: z.number().int(),
  connected: z.number().int(),
  booked: z.number().int(),
  bookingRate: z.number(),
  cuesShown: z.number().int(),
  cuesUsed: z.number().int(),
  debriefed: z.number().int(),
  avgRating: z.number().nullable(),
});
export type TeamTotals = z.infer<typeof TeamTotals>;
export const TeamQuery = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  weeks: z.coerce.number().int().min(1).max(26).optional(),
});
export type TeamQuery = Partial<z.infer<typeof TeamQuery>>;
export const TeamResponse = z.object({ members: z.array(TeamMember), totals: TeamTotals.optional(), from: EpochMs.optional(), to: EpochMs.optional() });
export type TeamResponse = z.infer<typeof TeamResponse>;

/** A saved contact: someone the team calls. Starting a call from one fills in the prospect. */
export const Contact = z.object({
  id: Id,
  name: z.string().max(200),
  title: z.string().max(200),
  company: z.string().max(200),
  phone: z.string().max(40).nullable(),
  email: z.string().max(200).nullable(),
  crmId: z.string().max(120).nullable(),
  facts: z.record(z.string(), z.string().max(500)),
  notes: z.string().max(2000).nullable(),
  ownerRepId: z.string().max(120).nullable(),
  createdAt: EpochMs,
  updatedAt: EpochMs,
  lastCalledAt: EpochMs.nullable(),
  calls: z.number().int().nonnegative(),
  lastOutcome: z.string().nullable(),
});
export type Contact = z.infer<typeof Contact>;

export const ContactInput = z.object({
  name: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).default(''),
  company: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
  crmId: z.string().trim().max(120).optional(),
  facts: z.record(z.string().max(60), z.string().max(500)).default({}),
  notes: z.string().max(2000).optional(),
  ownerRepId: z.string().max(120).optional(),
});
export type ContactInput = z.input<typeof ContactInput>;

export const ContactListQuery = z.object({
  q: z.string().max(120).optional(),
  ownerRepId: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ContactListQuery = Partial<z.infer<typeof ContactListQuery>>;
export const ContactListResponse = z.object({ items: z.array(Contact), total: z.number().int().nonnegative() });
export type ContactListResponse = z.infer<typeof ContactListResponse>;

/** CSV with a header row. Recognised columns: name, title, company, phone, email, crm id, notes; any other column becomes a fact. */
export const ContactImportRequest = z.object({ csv: z.string().min(1).max(2_000_000), ownerRepId: z.string().max(120).optional() });
export type ContactImportRequest = z.infer<typeof ContactImportRequest>;
export const ContactImportResponse = z.object({
  imported: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.object({ line: z.number().int(), message: z.string() })).max(100),
});
export type ContactImportResponse = z.infer<typeof ContactImportResponse>;

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
  mubit: z.object({ configured: z.boolean(), reachable: z.boolean().nullable(), models: z.object({ fast: z.string(), write: z.string(), live: z.string().optional() }) }),
  /** `layered` (rules read + Mubit refinement) or `live` (one streamed live_cue call per turn). */
  pipeline: z.enum(['layered', 'live']).optional(),
  /** Speech-to-text tokens for the browser (`POST /api/stt/token`). */
  stt: z.object({ configured: z.boolean() }).optional(),
  trellus: z.object({ configured: z.boolean(), reachable: z.boolean().nullable(), lastSyncAt: EpochMs.nullable() }),
  sapling: z.object({ configured: z.boolean() }),
  exa: z.object({ configured: z.boolean() }),
  valyu: z.object({ configured: z.boolean() }).optional(),
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
export const SttTokenResponse = z.object({
  provider: z.literal('deepgram'),
  token: z.string().min(1),
  expiresAt: EpochMs,
  /** The Deepgram host the token is for (`api.deepgram.com`, or `api.eu.deepgram.com` for the EU endpoint). */
  host: z.string().max(120).optional(),
});
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

/* ───────────── Traces and insights: every Mubit call, kept by the server (Mubit has no trace export). Additive only. ───────────── */

/** Time window for insights and exports. `all` = no lower bound. */
export const TraceRange = z.enum(['24h', '7d', '30d', 'all']);
export type TraceRange = z.infer<typeof TraceRange>;

/**
 * One Mubit (GPT) call as the server saw it: success, failure, timeout, or sent-then-cancelled.
 * `input` is the task input JSON sent as the user message; `output` the parsed answer (null on failure).
 * Both are null under `CUE_MUBIT_RECORD=metadata`; a body over the size cap is kept as a string prefix
 * and `truncated` is true.
 */
export const MubitTrace = z.object({
  id: z.string(),
  /** `x-middleware-request-id`: the join key to the Mubit console. */
  requestId: z.string().nullable(),
  task: z.enum(TASK_IDS),
  model: z.string(),
  /** The Mubit session (`prompt_cache_key`): the phone call's id, or a seed/script session. */
  sessionId: z.string(),
  /** The phone call this belongs to, when the session is one. */
  callId: z.string().nullable(),
  /** The card this call fed (write_line, check_claim), linked after the card is shown. */
  suggestionId: z.string().nullable(),
  ok: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  latencyMs: z.number().int().nonnegative(),
  /** HTTP attempts inside the run (retries included); 0 when unknown (failed runs). */
  attempts: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number(),
  /** When the run finished (epoch ms). It started at `at - latencyMs`. */
  at: EpochMs,
  /** The task definition's `version` in packages/mubit (bumped whenever its instructions change). */
  instructionsVersion: z.number().int(),
  input: z.unknown(),
  output: z.unknown(),
  /** Cancelled by the caller (superseded turn, dropped speculative draft) after the request went out. */
  aborted: z.boolean(),
  truncated: z.boolean().optional(),
});
export type MubitTrace = z.infer<typeof MubitTrace>;

/** A trace without its bodies: what the list returns. */
export const MubitTraceSummary = MubitTrace.omit({ input: true, output: true });
export type MubitTraceSummary = z.infer<typeof MubitTraceSummary>;

const boolParam = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** `GET /api/traces` query. `before` is the previous page's `nextCursor`. */
export const TraceListQuery = z.object({
  task: z.enum(TASK_IDS).optional(),
  callId: z.string().min(1).max(120).optional(),
  ok: boolParam.optional(),
  before: z.string().regex(/^\d+$/, 'before must be a cursor from a previous page').max(20).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type TraceListQuery = z.infer<typeof TraceListQuery>;

/** `GET /api/traces` → newest first. `nextCursor` is null on the last page. */
export const TraceListResponse = z.object({ items: z.array(MubitTraceSummary), nextCursor: z.string().nullable() });
export type TraceListResponse = z.infer<typeof TraceListResponse>;

/** `GET /api/traces/:id` → the full trace. */
export const TraceDetail = MubitTrace;
export type TraceDetail = z.infer<typeof TraceDetail>;

/** `GET /api/traces/export` query. */
export const TraceExportFormat = z.enum(['jsonl', 'openai', 'langfuse']);
export type TraceExportFormat = z.infer<typeof TraceExportFormat>;
export const TraceExportQuery = z.object({ format: TraceExportFormat.default('jsonl'), task: z.enum(TASK_IDS).optional(), range: TraceRange.default('all') });
export type TraceExportQuery = z.infer<typeof TraceExportQuery>;

/** `GET /api/insights` query. */
export const InsightsQuery = z.object({ range: TraceRange.default('7d') });
export type InsightsQuery = z.infer<typeof InsightsQuery>;

export const TaskInsight = z.object({
  task: z.enum(TASK_IDS),
  calls: z.number().int(),
  ok: z.number().int(),
  /** Failures and timeouts; cancelled-but-sent runs are counted in `aborted`, not here. */
  failed: z.number().int(),
  aborted: z.number().int(),
  /** Over successful runs. */
  p50Ms: z.number(),
  p95Ms: z.number(),
  costUsd: z.number(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  errorsByCode: z.record(z.string(), z.number().int()),
});
export type TaskInsight = z.infer<typeof TaskInsight>;

/** Rates are 0..1 and 0 when their denominator is 0. */
export const InsightsResponse = z.object({
  range: TraceRange,
  /** Window start (epoch ms; 0 for `all`) and the server's now. */
  since: EpochMs,
  until: EpochMs,
  /** Series bucket: hours for 24h, days otherwise. */
  bucket: z.enum(['hour', 'day']),
  tasks: z.array(TaskInsight),
  totals: z.object({ calls: z.number().int(), ok: z.number().int(), costUsd: z.number(), inputTokens: z.number().int(), outputTokens: z.number().int() }),
  /** One point per (bucket, task) that saw a call; `t` is the bucket's start. */
  series: z.array(z.object({ t: EpochMs, task: z.enum(TASK_IDS), calls: z.number().int(), costUsd: z.number(), p50Ms: z.number() })),
  /** From the call event log, for calls started in the window. */
  outcomes: z.object({
    calls: z.object({ total: z.number().int(), withOutcome: z.number().int(), booked: z.number().int(), bookingRate: z.number() }),
    /** Calls with an outcome, split by whether the rep used (or edited) at least one card. */
    cueUsage: z.object({
      used: z.object({ calls: z.number().int(), booked: z.number().int(), bookingRate: z.number() }),
      notUsed: z.object({ calls: z.number().int(), booked: z.number().int(), bookingRate: z.number() }),
    }),
    moments: z.array(
      z.object({
        moment: MomentZ,
        shown: z.number().int(),
        used: z.number().int(),
        usedRate: z.number(),
        /** Cards a review judged, and how many of those won their step. */
        judged: z.number().int(),
        stepWins: z.number().int(),
        stepWinRate: z.number(),
        /** Cards shown on calls that booked. */
        booked: z.number().int(),
        bookedRate: z.number(),
      }),
    ),
    /** Best first by booked, then used. */
    topLines: z.array(
      z.object({ lineId: z.string(), text: z.string(), moment: MomentZ, shown: z.number().int(), used: z.number().int(), booked: z.number().int(), usedRate: z.number(), bookedRate: z.number() }),
    ),
    servedBy: z.object({
      cards: z.object({ mubit: z.number().int(), rules: z.number().int(), cache: z.number().int() }),
      reads: z.object({ mubit: z.number().int(), rules: z.number().int() }),
    }),
    writePath: z.object({ speculative: z.number().int(), rewritten: z.number().int(), direct: z.number().int() }),
    /** Prospect turn → card on screen (`Suggestion.latencyMs`), line cards only. */
    latency: z.object({ cards: z.number().int(), p50Ms: z.number(), p95Ms: z.number() }),
    reviews: z.object({ count: z.number().int(), mubit: z.number().int(), avgSuggestionImpact: z.number().nullable(), avgRating: z.number().nullable() }),
  }),
});
export type InsightsResponse = z.infer<typeof InsightsResponse>;
