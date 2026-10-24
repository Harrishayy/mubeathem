import { z } from 'zod';
import { MIN_PLAUSIBLE_MICROS } from './time';

/** Request bodies for the reporting endpoints, exactly as documented (snake_case, µs timestamps). */

export const FilterOperator = z.enum(['EQ', 'NEQ', 'GT', 'GE', 'LT', 'LE', 'IN', 'NIN', 'REGEX']);
export type FilterOperator = z.infer<typeof FilterOperator>;

export const Filter = z
  .object({
    column_name: z.string().min(1),
    operator: FilterOperator,
    /** Typed value: real booleans and numbers, arrays for IN/NIN, base64 for bytes. */
    value_safe: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))]),
    reducer: z.enum(['ANY', 'ALL']).optional(),
  })
  .refine((f) => (f.column_name.includes('[*]') ? f.reducer !== undefined : f.reducer === undefined), {
    message: 'reducer is required on a [*] path and not allowed otherwise',
  })
  .refine((f) => (f.operator === 'IN' || f.operator === 'NIN') === Array.isArray(f.value_safe), {
    message: 'IN and NIN take an array; other operators take a single value',
  });
export type Filter = z.infer<typeof Filter>;

/** AND of OR groups. Inner groups must not be empty. */
export const Cnf = z.array(z.array(Filter).min(1));
export type Cnf = z.infer<typeof Cnf>;

const Micros = z
  .number()
  .int()
  .refine((v) => v >= MIN_PLAUSIBLE_MICROS, { message: 'start/end are Unix microseconds (Date.parse(iso) * 1000)' });

const windowed = {
  /** Inclusive, Unix microseconds. */
  start: Micros,
  /** Exclusive, Unix microseconds. Defaults to now. */
  end: Micros.optional(),
  team_id: z.string().min(1).optional(),
  cnf: Cnf.optional(),
};

export const SessionListRequest = z
  .object({
    ...windowed,
    select: z.array(z.string().min(1)).min(1),
    /** Row cap, not a page size. Default 50. */
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .refine((r) => r.end === undefined || r.end > r.start, { message: 'end must be after start' });
export type SessionListRequest = z.infer<typeof SessionListRequest>;

export const Aggregate = z
  .object({ cnf: Cnf.optional(), column_name: z.string().min(1).optional() })
  .refine((a) => a.cnf !== undefined || a.column_name !== undefined, { message: 'an empty aggregation {} is invalid' });
export type Aggregate = z.infer<typeof Aggregate>;

export const GroupBy = z
  .object({
    column_name: z.string().min(1),
    step_size_safe: z.number().positive().optional(),
    step_start_safe: z.number().optional(),
    step_modulus_safe: z.number().positive().optional(),
  })
  .refine((g) => g.step_size_safe === undefined || g.step_start_safe !== undefined, { message: 'step_size_safe needs step_start_safe' });
export type GroupBy = z.infer<typeof GroupBy>;

export const MetricRequest = z
  .object({ ...windowed, selects: z.array(Aggregate).min(1), group_by: GroupBy.optional() })
  .refine((r) => r.end === undefined || r.end > r.start, { message: 'end must be after start' });
export type MetricRequest = z.infer<typeof MetricRequest>;

/** Rows from session-list-v6 and metric-details-v7: positional arrays. */
export const Rows = z.array(z.array(z.unknown()));
export type Rows = unknown[][];

/** GET /visible. `team` appears only with whole-team read access. */
export const VisibleDirectory = z.looseObject({
  team: z.looseObject({ team_id: z.string(), team: z.string().optional() }).optional(),
  users: z.array(z.looseObject({ user_id: z.string(), user_name: z.string().optional() })).default([]),
  user_id_to_email: z.record(z.string(), z.string()).default({}),
  groups: z.array(z.unknown()).default([]),
  memberships: z
    .array(z.looseObject({ user_group_id: z.string().optional(), member_id: z.string().optional(), member_is_group: z.boolean().optional() }))
    .default([]),
});
export type VisibleDirectory = z.infer<typeof VisibleDirectory>;

/** GET /bootstrap: account configuration. Its shape is not documented, so it is kept loose. */
export const Bootstrap = z.record(z.string(), z.unknown());
export type Bootstrap = z.infer<typeof Bootstrap>;

/**
 * GET /session with `x-proto-as-json: true`: protobuf JSON, camelCase, enum names, default values
 * omitted, no wordData. Only the parts Cue reads are named.
 */
export const SessionDetail = z.looseObject({
  sessionId: z.string(),
  startedAt: z.number().optional(),
  conversationType: z.union([z.string(), z.number()]).optional(),
  customerAddress: z.string().optional(),
  resourceId: z.string().optional(),
  duration: z.number().optional(),
  customerData: z
    .looseObject({ name: z.string().optional(), title: z.string().optional(), companyName: z.string().optional(), companyUrl: z.string().optional(), customFields: z.string().optional() })
    .optional(),
  turnData: z
    .looseObject({
      texts: z.array(z.string()).optional(),
      isCustomers: z.array(z.boolean()).optional(),
      starts: z.array(z.number()).optional(),
      ends: z.array(z.number()).optional(),
    })
    .optional(),
  dialMetric: z.looseObject({ liveDuration: z.number().optional() }).optional(),
  userLog: z
    .looseObject({ disposition: z.string().optional(), sentiment: z.string().optional(), purpose: z.string().optional(), notes: z.string().optional() })
    .optional(),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

/** GET /get-audio-links. `audio_links[i]` is the URL for `audio[i]`; links expire after an hour. */
export const AudioLinks = z.looseObject({
  session: z.record(z.string(), z.unknown()),
  audio: z.array(z.unknown()).default([]),
  audio_links: z.array(z.string()).default([]),
});
export type AudioLinks = z.infer<typeof AudioLinks>;

/** Shorthand for a single-condition OR group. */
export const where = (column_name: string, operator: FilterOperator, value_safe: Filter['value_safe']): Filter[] => [
  { column_name, operator, value_safe } as Filter,
];

/** The docs' recommended "real connected call" filter. */
export const CONNECTED_CALLS: Cnf = [where('conversation_type', 'EQ', 1), where('dial_metric.live_duration', 'GE', 30)];
export const CALLS_ONLY: Cnf = [where('conversation_type', 'EQ', 1)];
