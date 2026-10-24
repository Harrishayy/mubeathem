import { z } from 'zod';
import { ATTITUDES, MOMENTS, OUTCOMES, PERSONAS, POLICY_VERDICTS, PRODUCT_LINES, RECEPTIVITY, TONE_SIGNALS } from '../taxonomy';

/** Ids are opaque strings. Calls: `call_<ulid>`, suggestions `sug_…`, lines `line_…`, turns `turn_…`. */
export const Id = z.string().min(1).max(120);

/** Milliseconds since the Unix epoch. */
export const EpochMs = z.number().int().nonnegative();

export const PersonaZ = z.enum(PERSONAS);
export const ReceptivityZ = z.enum(RECEPTIVITY);
export const MomentZ = z.enum(MOMENTS);
export const ToneSignalZ = z.enum(TONE_SIGNALS);
export const ProductLineZ = z.enum(PRODUCT_LINES);
export const PolicyVerdictZ = z.enum(POLICY_VERDICTS);
export const OutcomeZ = z.enum(OUTCOMES);
export const AttitudeZ = z.enum(ATTITUDES);

/** Who placed the call and where its audio/outcome come from. */
export const CallSourceZ = z.enum(['cue', 'trellus', 'practice', 'import']);
export type CallSource = z.infer<typeof CallSourceZ>;

export const Prospect = z.object({
  name: z.string().max(200).default(''),
  title: z.string().max(200).default(''),
  company: z.string().max(200).default(''),
  phone: z.string().max(40).optional(),
  email: z.string().max(200).optional(),
  /** HubSpot / CRM record id, when known. */
  crmId: z.string().max(120).optional(),
  /** Free-form CRM facts (stage, funding, headcount). Values are short strings. */
  facts: z.record(z.string(), z.string().max(500)).default({}),
});
export type Prospect = z.infer<typeof Prospect>;

export const Rep = z.object({
  id: Id,
  name: z.string().max(120),
  /** Days on the phones; drives onboarding vs veteran density (context.md §14). */
  tenureDays: z.number().int().nonnegative().optional(),
});
export type Rep = z.infer<typeof Rep>;

export const Speaker = z.enum(['rep', 'prospect']);
export type Speaker = z.infer<typeof Speaker>;

/** One utterance. Interim (non-final) turns stream in and are replaced by the final one with the same id. */
export const Turn = z.object({
  id: Id,
  speaker: Speaker,
  text: z.string().max(4000),
  /** Offset from call start, ms. */
  tMs: z.number().int().nonnegative(),
  /** Duration of the utterance, ms, when the transcriber knows it. */
  durMs: z.number().int().nonnegative().optional(),
  final: z.boolean().default(true),
  /** Which transcriber produced it, e.g. `webspeech`, `deepgram`, `trellus`, `typed`, `sim`. */
  via: z.string().max(40).default('typed'),
});
export type Turn = z.infer<typeof Turn>;

/** Conversation-level tone, 0..1 each, read from words and turn shape (never voice). */
export const Tone = z.object({
  engagement: z.number().min(0).max(1),
  warmth: z.number().min(0).max(1),
  patience: z.number().min(0).max(1),
  interest: z.number().min(0).max(1),
});
export type Tone = z.infer<typeof Tone>;

/** Cheap features computed in code from the transcript, sent with every read_moment call. */
export const TurnFeatures = z.object({
  turnIndex: z.number().int().nonnegative(),
  prospectWords: z.number().int().nonnegative(),
  repWords: z.number().int().nonnegative(),
  /** Prospect share of words over the last 6 turns, 0..1. */
  prospectShare: z.number().min(0).max(1),
  /** Change in prospect share vs the 6 turns before; positive = opening up. */
  shareTrend: z.number().min(-1).max(1),
  /** Gap between the rep finishing and the prospect starting, ms, when known. */
  replyLatencyMs: z.number().int().nonnegative().optional(),
  /** Prospect started before the rep finished. */
  interrupted: z.boolean(),
  questionsAsked: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
});
export type TurnFeatures = z.infer<typeof TurnFeatures>;

/** Cue's read of the moment after a prospect turn. */
export const Situation = z.object({
  persona: PersonaZ,
  personaConfidence: z.number().min(0).max(1),
  receptivity: ReceptivityZ,
  /** -1 (cold) .. 1 (warm). */
  receptivityScore: z.number().min(-1).max(1),
  moment: MomentZ,
  momentConfidence: z.number().min(0).max(1),
  tone: Tone,
  signals: z.array(ToneSignalZ).max(12),
  /** Whether a card should be shown now (quiet during good small talk, mid-sentence, voicemail). */
  shouldSuggest: z.boolean(),
  /** One short clause, for the drawer and for Mubit's record. */
  rationale: z.string().max(300),
});
export type Situation = z.infer<typeof Situation>;

export const LineStats = z.object({
  shown: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  stepWins: z.number().int().nonnegative(),
  booked: z.number().int().nonnegative(),
  /** Calls where the line was used and the call was lost. */
  lost: z.number().int().nonnegative(),
});
export type LineStats = z.infer<typeof LineStats>;

/** A line in the team playbook. Stats are kept per situation key. */
export const PlaybookLine = z.object({
  id: Id,
  moment: MomentZ,
  /** Situation keys this line is meant for; empty = any persona/receptivity for the moment. */
  personas: z.array(PersonaZ).default([]),
  receptivity: z.array(ReceptivityZ).default([]),
  text: z.string().max(400),
  /** Short style tag shown in the playbook: `straight`, `self-aware`, `question`, `proof`. */
  style: z.string().max(40).default('straight'),
  products: z.array(ProductLineZ).default([]),
  status: z.enum(['active', 'candidate', 'retired', 'rejected']),
  origin: z.enum(['seed', 'rep', 'manager', 'model']),
  createdAt: EpochMs,
  /** `situationKey` → stats. The key `*` holds the line's totals. */
  stats: z.record(z.string(), LineStats).default({}),
  /** For candidates: the call and turn the line was mined from. */
  minedFrom: z.object({ callId: Id, turnId: Id.optional(), repId: Id.optional(), repName: z.string().max(120).optional() }).optional(),
  policy: z.object({ verdict: PolicyVerdictZ, note: z.string().max(300).optional() }).optional(),
});
export type PlaybookLine = z.infer<typeof PlaybookLine>;

/** Evidence a card shows: "Books 2.1× more than the straight answer with cold CEOs · 41 calls". */
export const Evidence = z.object({
  text: z.string().max(200),
  calls: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1).optional(),
  /** `bandit` = ranked by Thompson sampling, `explore` = a new line getting a fair trial, `model` = no history yet. */
  basis: z.enum(['bandit', 'explore', 'model']),
});
export type Evidence = z.infer<typeof Evidence>;

export const UpNext = z.object({
  ifTheySay: z.string().max(120),
  move: z.string().max(160),
  moment: MomentZ,
});
export type UpNext = z.infer<typeof UpNext>;

/** What the rep sees on the card. */
export const Suggestion = z.object({
  id: Id,
  callId: Id,
  /** The prospect turn that triggered it. */
  turnId: Id,
  situation: Situation,
  /** The line to say now. One breath. */
  say: z.string().max(320),
  why: z.string().max(200),
  /** The playbook line it was tailored from. */
  lineId: Id,
  evidence: Evidence,
  upNext: z.array(UpNext).max(3),
  /** Compliance cards carry the claim and a safe rephrase. */
  kind: z.enum(['line', 'compliance']),
  compliance: z
    .object({ claim: z.string().max(400), verdict: PolicyVerdictZ, rule: z.string().max(300), rephrase: z.string().max(320) })
    .optional(),
  createdAt: EpochMs,
  /** ms from the prospect finishing to the card being ready. */
  latencyMs: z.number().int().nonnegative(),
  /** Which path produced it, shown in the debug drawer: never present a fallback as the model. */
  servedBy: z.enum(['mubit', 'rules', 'cache']),
  /** Mubit request ids behind this card (read_moment, write_line, check_claim). */
  mubitRequestIds: z.array(z.string().max(80)).default([]),
  /**
   * Debug (ws04): how the live pipeline wrote it. `speculative` = write_line ran on the rules read in
   * parallel with read_moment and the moments matched; `rewritten` = they differed, so it was written
   * again on the model read; `direct` = written once after the read. Absent on compliance cards.
   */
  writePath: z.enum(['speculative', 'rewritten', 'direct']).optional(),
  /**
   * Latency layers (architecture.md §5.3). `instant` = shown before any Mubit call returned (rules
   * read + playbook line, or a precomputed Mubit line with `servedBy: 'cache'`); `refined` = the same
   * card id re-emitted once Mubit's read/write landed. Absent when there is no refinement layer
   * (rules-only server, compliance cards). The reducer replaces a shown card with the same id.
   */
  stage: z.enum(['instant', 'refined']).optional(),
  /** When the refined version replaced the instant one (epoch ms). */
  refinedAt: EpochMs.optional(),
  /** ms from the prospect finishing to the refined version. `latencyMs` stays the first card's. */
  refinedLatencyMs: z.number().int().nonnegative().optional(),
  /** For `servedBy: 'cache'`: where the precomputed Mubit line came from (`standby` = written ahead for a predicted moment). */
  precomputed: z.enum(['standby']).optional(),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const SuggestionAction = z.enum(['used', 'dismissed', 'edited', 'thumbs_up', 'thumbs_down', 'expired']);
export type SuggestionAction = z.infer<typeof SuggestionAction>;

export const ResearchHook = z.object({
  hook: z.string().max(240),
  product: ProductLineZ,
  source: z.string().max(400).optional(),
  /** `exa` | `valyu` | `crm` | `web` | `manual` | `fixture` */
  via: z.string().max(20),
  /** The page the hook came from, when it came from research. */
  url: z.string().max(2000).optional(),
});
export type ResearchHook = z.infer<typeof ResearchHook>;

/** A page the brief read, for the "where this came from" list. */
export const BriefSource = z.object({
  title: z.string().max(200),
  url: z.string().max(2000).nullable(),
  via: z.string().max(20),
  publishedAt: z.string().max(40).nullable(),
});
export type BriefSource = z.infer<typeof BriefSource>;

export const Brief = z.object({
  summary: z.string().max(400),
  hooks: z.array(ResearchHook).max(5),
  opener: z.string().max(320),
  personaGuess: PersonaZ,
  servedBy: z.enum(['mubit', 'rules', 'cache']),
  /** What the research read (Exa, Valyu, CRM), newest-first where dated. */
  sources: z.array(BriefSource).max(12).optional(),
});
export type Brief = z.infer<typeof Brief>;

/** The rep's post-call debrief. Every field is optional except the outcome. */
export const RepFeedback = z.object({
  outcome: OutcomeZ,
  /** 1 (terrible) .. 5 (great): how the rep felt the call went. */
  rating: z.number().int().min(1).max(5).optional(),
  attitude: AttitudeZ.optional(),
  whatWorked: z.string().max(1000).optional(),
  whatDidnt: z.string().max(1000).optional(),
  /** A line the rep wishes they'd had, or what they actually said that worked. */
  betterLine: z.string().max(400).optional(),
  /** Suggestion ids the rep marks as having helped / hurt. */
  helpful: z.array(Id).max(50).default([]),
  unhelpful: z.array(Id).max(50).default([]),
  notes: z.string().max(2000).optional(),
  submittedAt: EpochMs,
});
export type RepFeedback = z.infer<typeof RepFeedback>;

/** Where the final outcome came from. Rep tap < Trellus disposition < HubSpot meeting (most trusted last). */
export const OutcomeRecord = z.object({
  outcome: OutcomeZ,
  source: z.enum(['rep', 'trellus', 'hubspot', 'review']),
  /** Raw disposition / sentiment / purpose strings from Trellus, verbatim. */
  raw: z.record(z.string(), z.string()).default({}),
  at: EpochMs,
});
export type OutcomeRecord = z.infer<typeof OutcomeRecord>;

export const PolicyCheck = z.object({
  claim: z.string().max(400),
  verdict: PolicyVerdictZ,
  rule: z.string().max(300),
  rephrase: z.string().max(320).optional(),
  /** `sapling` | `mubit` | `rules` */
  via: z.string().max(20),
  speaker: Speaker,
  turnId: Id.optional(),
  /** When the check landed (epoch ms). The reducer stamps it from the event so the UI can age flags. */
  at: EpochMs.optional(),
});
export type PolicyCheck = z.infer<typeof PolicyCheck>;
