import { z } from 'zod';
import {
  AttitudeZ,
  Id,
  MomentZ,
  OutcomeZ,
  PersonaZ,
  PolicyVerdictZ,
  ProductLineZ,
  ReceptivityZ,
  Situation,
  Speaker,
  Tone,
  ToneSignalZ,
  TurnFeatures,
  UpNext,
} from './domain';

/**
 * Model tasks. Each one is a fixed system prompt + fixed output schema, so every call of a task lands
 * in the same Mubit task and trains the same adapter (docs/mubit/llms-full.txt, "What makes a task").
 * Anything call-specific goes in the user message as JSON matching the `*Input` schema below.
 *
 * Output schemas are written to be convertible to OpenAI strict JSON schema: no optional keys (use
 * nullable), no defaults, no unions other than nullable. packages/mubit converts them.
 */

export const TASK_IDS = ['read_moment', 'write_line', 'research_brief', 'check_claim', 'review_call', 'simulate_prospect'] as const;
export type TaskId = (typeof TASK_IDS)[number];

/* ───────────── read_moment: after every final prospect turn ───────────── */

export const ReadMomentInput = z.object({
  crm: z.object({ title: z.string(), company: z.string(), facts: z.record(z.string(), z.string()) }),
  /** Last ~30 s / 8 turns, oldest first. */
  window: z.array(z.object({ speaker: Speaker, text: z.string(), tMs: z.number() })),
  features: TurnFeatures,
  /** The previous read, so persona and receptivity drift instead of jumping. */
  previous: z.object({ persona: PersonaZ, receptivity: ReceptivityZ, moment: MomentZ }).nullable(),
});
export type ReadMomentInput = z.infer<typeof ReadMomentInput>;

export const ReadMomentOutput = z.object({
  persona: PersonaZ,
  persona_confidence: z.number(),
  receptivity: ReceptivityZ,
  receptivity_score: z.number(),
  moment: MomentZ,
  moment_confidence: z.number(),
  tone: z.object({ engagement: z.number(), warmth: z.number(), patience: z.number(), interest: z.number() }),
  signals: z.array(ToneSignalZ),
  should_suggest: z.boolean(),
  rationale: z.string(),
});
export type ReadMomentOutput = z.infer<typeof ReadMomentOutput>;

/* ───────────── write_line: at every decision moment ───────────── */

export const WriteLineInput = z.object({
  situation: z.object({ persona: PersonaZ, receptivity: ReceptivityZ, moment: MomentZ, signals: z.array(ToneSignalZ) }),
  lastProspectTurn: z.string(),
  /** Recent turns for context, oldest first. */
  window: z.array(z.object({ speaker: Speaker, text: z.string() })),
  /** Top playbook lines for this situation, best first, with their record. */
  candidates: z.array(
    z.object({ line_id: Id, text: z.string(), style: z.string(), shown: z.number(), used: z.number(), step_wins: z.number(), booked: z.number(), sampled_win_rate: z.number() }),
  ),
  hooks: z.array(z.object({ hook: z.string(), product: ProductLineZ })),
  prospect: z.object({ name: z.string(), title: z.string(), company: z.string() }),
  rep: z.object({ name: z.string(), company: z.string() }),
  /** Lines already shown this call, so Cue doesn't repeat itself. */
  alreadySaid: z.array(z.string()),
});
export type WriteLineInput = z.infer<typeof WriteLineInput>;

export const WriteLineOutput = z.object({
  say: z.string(),
  why: z.string(),
  /** Must be one of the candidate line_ids; the line it tailored. */
  line_id: z.string(),
  up_next: z.array(z.object({ if_they_say: z.string(), move: z.string(), moment: MomentZ })),
  /** The writer flags anything in its own line that might need a policy check. */
  risky_claim: z.string().nullable(),
});
export type WriteLineOutput = z.infer<typeof WriteLineOutput>;

/* ───────────── research_brief: when the call starts ───────────── */

export const ResearchBriefInput = z.object({
  prospect: z.object({ name: z.string(), title: z.string(), company: z.string(), facts: z.record(z.string(), z.string()) }),
  /** Exa highlights or CRM notes. Empty when nothing was found. */
  findings: z.array(z.object({ title: z.string(), text: z.string(), url: z.string().nullable(), publishedAt: z.string().nullable() })),
  seller: z.object({ company: z.string(), offer: z.string() }),
});
export type ResearchBriefInput = z.infer<typeof ResearchBriefInput>;

export const ResearchBriefOutput = z.object({
  summary: z.string(),
  hooks: z.array(z.object({ hook: z.string(), product: ProductLineZ, source: z.string().nullable() })),
  opener: z.string(),
  persona_guess: PersonaZ,
});
export type ResearchBriefOutput = z.infer<typeof ResearchBriefOutput>;

/* ───────────── check_claim: suggestions before they're shown, rep claims live ───────────── */

export const CheckClaimInput = z.object({
  claim: z.string(),
  speaker: Speaker,
  policy: z.array(z.string()),
  /** What is known so far: quote status, underwriting status, prospect facts. */
  evidence: z.array(z.string()),
});
export type CheckClaimInput = z.infer<typeof CheckClaimInput>;

export const CheckClaimOutput = z.object({
  verdict: PolicyVerdictZ,
  rule: z.string(),
  rephrase: z.string().nullable(),
  confidence: z.number(),
});
export type CheckClaimOutput = z.infer<typeof CheckClaimOutput>;

/* ───────────── review_call: after the call, with every label we have ───────────── */

/**
 * The full structured record of one call. This is the most important payload in Cue: it is what
 * review_call reads, what the dataset export writes, and what lets Mubit learn which lines work.
 * Built by `buildCallRecord` from the event log.
 */
export const CallRecord = z.object({
  callId: Id,
  source: z.string(),
  startedAt: z.number(),
  durationMs: z.number(),
  prospect: z.object({ name: z.string(), title: z.string(), company: z.string(), facts: z.record(z.string(), z.string()) }),
  rep: z.object({ id: z.string(), name: z.string(), tenureDays: z.number().nullable() }),
  transcript: z.array(z.object({ id: z.string(), speaker: Speaker, text: z.string(), tMs: z.number() })),
  /** One entry per prospect turn that was read. */
  situations: z.array(
    z.object({ turnId: z.string(), tMs: z.number(), persona: PersonaZ, receptivity: ReceptivityZ, receptivityScore: z.number(), moment: MomentZ, tone: Tone, signals: z.array(ToneSignalZ), features: TurnFeatures }),
  ),
  suggestions: z.array(
    z.object({
      id: z.string(),
      turnId: z.string(),
      lineId: z.string(),
      moment: MomentZ,
      situationKey: z.string(),
      say: z.string(),
      kind: z.enum(['line', 'compliance']),
      shownAtMs: z.number(),
      latencyMs: z.number(),
      servedBy: z.string(),
      /** Rep's explicit actions in order. */
      actions: z.array(z.object({ action: z.string(), text: z.string().nullable(), atMs: z.number() })),
      /** Filled by review: did the rep say it (or something close)? */
      used: z.boolean().nullable(),
      stepWin: z.boolean().nullable(),
      mubitRequestIds: z.array(z.string()),
    }),
  ),
  policyChecks: z.array(z.object({ claim: z.string(), verdict: PolicyVerdictZ, speaker: Speaker, rule: z.string(), via: z.string() })),
  /** Receptivity over time, for the sparkline and for review. */
  receptivityTrend: z.array(z.object({ tMs: z.number(), score: z.number() })),
  outcome: z.object({ outcome: OutcomeZ, source: z.string(), raw: z.record(z.string(), z.string()) }).nullable(),
  feedback: z
    .object({
      outcome: OutcomeZ,
      rating: z.number().nullable(),
      attitude: AttitudeZ.nullable(),
      whatWorked: z.string().nullable(),
      whatDidnt: z.string().nullable(),
      betterLine: z.string().nullable(),
      helpful: z.array(z.string()),
      unhelpful: z.array(z.string()),
      notes: z.string().nullable(),
    })
    .nullable(),
  /** Trellus fields copied verbatim when the call came from or was matched to Trellus. */
  trellus: z.record(z.string(), z.unknown()).nullable(),
});
export type CallRecord = z.infer<typeof CallRecord>;

export const ReviewCallOutput = z.object({
  summary: z.string(),
  outcome: OutcomeZ,
  lines_used: z.array(z.object({ suggestion_id: z.string(), used: z.boolean(), said_text: z.string().nullable(), similarity: z.number(), step_win: z.boolean() })),
  candidate_lines: z.array(z.object({ moment: MomentZ, persona: PersonaZ, receptivity: ReceptivityZ, text: z.string(), turn_id: z.string().nullable(), rationale: z.string() })),
  missed_moments: z.array(z.object({ turn_id: z.string(), moment: MomentZ, note: z.string() })),
  what_worked: z.array(z.string()),
  what_didnt: z.array(z.string()),
  customer_attitude: AttitudeZ,
  coaching: z.array(z.string()),
  /** 0..1, how much the suggestions contributed to the outcome in the model's judgement. */
  suggestion_impact: z.number(),
});
export type ReviewCallOutput = z.infer<typeof ReviewCallOutput>;

/** Stored form of a review (camelCase, plus provenance). */
export const CallReview = z.object({
  summary: z.string().max(1000),
  outcome: OutcomeZ,
  linesUsed: z.array(z.object({ suggestionId: z.string(), used: z.boolean(), saidText: z.string().nullable(), similarity: z.number().min(0).max(1), stepWin: z.boolean() })),
  candidateLines: z.array(z.object({ moment: MomentZ, persona: PersonaZ, receptivity: ReceptivityZ, text: z.string().max(400), turnId: z.string().nullable(), rationale: z.string().max(400) })),
  missedMoments: z.array(z.object({ turnId: z.string(), moment: MomentZ, note: z.string().max(300) })),
  whatWorked: z.array(z.string().max(300)),
  whatDidnt: z.array(z.string().max(300)),
  customerAttitude: AttitudeZ,
  coaching: z.array(z.string().max(300)),
  suggestionImpact: z.number().min(0).max(1),
});
export type CallReview = z.infer<typeof CallReview>;

/* ───────────── simulate_prospect: practice mode and seeding ───────────── */

export const SimulateProspectInput = z.object({
  persona: z.object({ role: PersonaZ, name: z.string(), title: z.string(), company: z.string(), mood: ReceptivityZ, objections: z.array(z.string()), facts: z.record(z.string(), z.string()) }),
  transcript: z.array(z.object({ speaker: Speaker, text: z.string() })),
});
export type SimulateProspectInput = z.infer<typeof SimulateProspectInput>;

export const SimulateProspectOutput = z.object({
  reply: z.string(),
  /** The simulator's own label for what it just did; used as weak ground truth for read_moment. */
  intended_moment: MomentZ,
  mood_now: ReceptivityZ,
  ends_call: z.boolean(),
  books_meeting: z.boolean(),
});
export type SimulateProspectOutput = z.infer<typeof SimulateProspectOutput>;

export const TASK_OUTPUT = {
  read_moment: ReadMomentOutput,
  write_line: WriteLineOutput,
  research_brief: ResearchBriefOutput,
  check_claim: CheckClaimOutput,
  review_call: ReviewCallOutput,
  simulate_prospect: SimulateProspectOutput,
} as const satisfies Record<TaskId, z.ZodType>;

export const TASK_INPUT = {
  read_moment: ReadMomentInput,
  write_line: WriteLineInput,
  research_brief: ResearchBriefInput,
  check_claim: CheckClaimInput,
  review_call: z.object({ record: CallRecord, playbookContext: z.array(z.object({ line_id: z.string(), moment: MomentZ, text: z.string() })) }),
  simulate_prospect: SimulateProspectInput,
} as const satisfies Record<TaskId, z.ZodType>;

export type TaskInput<T extends TaskId> = z.infer<(typeof TASK_INPUT)[T]>;
export type TaskOutput<T extends TaskId> = z.infer<(typeof TASK_OUTPUT)[T]>;

/** Re-exported for consumers that only import tasks. */
export { Situation, UpNext };
