# 02 · Mubit tasks (`packages/mubit`)

The client every model call goes through, and the six task definitions. Server-side only (Node ≥ 22,
global `fetch`); never imported by a browser bundle.

Read: `context.md` §7, `hack.md`, `architecture.md` §4, `docs/mubit/llms-full.txt` (the full Mubit docs;
search it for "starter credit", "session", "x-middleware"), `packages/core/src/schema/tasks.ts`.

## What we already verified against the live API (2026-10-24)

- Base URL `https://api.mubit.ai/openai/v1`, `Authorization: Bearer $MUBIT_API_KEY`.
- The starter credit serves only: `gpt-6-sol, gpt-6.1-sol, gpt-6-luna, gpt-6-astra, gpt-5.5, gpt-4o-mini, gpt-4.1-mini` (+ dated ids). **Use `gpt-4o-mini` and `gpt-4.1-mini` only.**
- Chat Completions with `metadata` → 400 "metadata only allowed when store is enabled"; `store: true` → 400 `starter_credit_option`.
- `POST /responses` with `store: false`, `prompt_cache_key: "<callId>"`, `instructions`, `input`, and
  `text.format = { type: 'json_schema', name, strict: true, schema }` → 200, valid JSON in
  `output[].content[].text` (type `output_text`). Every answer has `x-middleware-request-id: mreq_…`.
- Errors come back as `{ error: { code, message, type: 'middleware_gateway_error' } }` with `x-should-retry`.
  `starter_credit_busy` is a 429 with `retry-after`.

## Build

| File | What |
|---|---|
| `src/config.ts` | `loadMubitConfig(env = process.env): MubitConfig` (`apiKey`, `baseUrl`, `models: {fast, write}`, `concurrency`, `timeoutMs`, `record: 'full'\|'metadata'`); `configured: boolean` |
| `src/strict-schema.ts` | `toStrictJsonSchema(schema: z.ZodType): object` via `z.toJSONSchema`, then make it OpenAI-strict: every object `additionalProperties: false` and all keys `required`, optional → nullable, strip `$schema`, `default`, `minLength`/`maxLength`/`minimum`/`maximum`/`pattern`/`format`; keep `enum`. Unit-test it on every task output schema |
| `src/tasks/*.ts` | One file per task in `TASK_IDS`: `export const readMoment: TaskDef<'read_moment'> = { id, tier: 'fast'\|'write', version: 1, instructions, output: ReadMomentOutput, maxOutputTokens, temperature }`. Instructions are constants (no interpolation, ever). Write them well: role, the taxonomy with one-line definitions of every moment/persona/receptivity/signal (import from core), scoring rules, the context.md style constraints for lines ("one breath", ≤ 25 words, no promises of coverage, use the prospect's first name sparingly), and 2 compact examples. `review_call` instructions explain every CallRecord field and how to judge "used" (similarity ≥ 0.6) and step wins (context.md §6.2) |
| `src/tasks/index.ts` | `TASKS: { [K in TaskId]: TaskDef<K> }` |
| `src/client.ts` | `createMubit(config, deps?: { fetch?, now? }): MubitClient` with `run<K extends TaskId>(task: K, input: TaskInput<K>, opts: { sessionId: string; signal?: AbortSignal; timeoutMs?: number }): Promise<TaskResult<K>>`, `TaskResult = { output: TaskOutput<K>; requestId: string \| null; latencyMs: number; model: string; usage: { input: number; output: number }; costUsd: number; attempts: number }`. Validates `input` against `TASK_INPUT[task]` before sending and `output` against `TASK_OUTPUT[task]` after (a parse failure is a `MubitError` with code `bad_output`, retried once). Concurrency semaphore, timeout via AbortSignal.any, retries per architecture §4.1, sends `x-middleware-record: metadata` when config.record is metadata |
| `src/errors.ts` | `class MubitError extends Error { code; status; retryable; requestId }` |
| `src/telemetry.ts` | in-memory per-task counters → `TaskStats` (core `api.ts`): calls, ok, failed, distinct sessions, p50/p95 latency, tokens, cost (list prices: gpt-4o-mini $0.15/$0.60 per 1M in/out, gpt-4.1-mini $0.40/$1.60), `adapterThreshold: 25`, last request id. `client.onCall(listener)` so the server can persist each call |
| `src/index.ts` | exports |
| `scripts/smoke.ts` | `tsx --env-file=../../.env scripts/smoke.ts`: one call per task with realistic inputs from `DEMO_SCRIPT`-like data; prints task, latency, request id, output |

## Tests

- `test/*.test.ts` (offline, run in CI): strict-schema conversion; client against a fake `fetch`
  (success, 429 + retry-after, 400 with x-should-retry false, timeout, malformed JSON, abort, concurrency
  cap respected, request id captured, input validation rejects bad input without a network call).
- `test/live/*.test.ts` (`MUBIT_LIVE=1`): each task once with realistic input; assert schema-valid
  output, request id present, latency recorded; `read_moment` on 8 labelled lines (gatekeeper, warm vs
  cold "what's this regarding?", broker objection, email brush-off, price question → buying signal,
  voicemail) and report accuracy (assert ≥ 6/8); `write_line` returns a `line_id` from its candidates
  and ≤ 30 words; `check_claim` flags "that would definitely be covered" as `violation`. Keep the
  whole live run under ~30 calls. Paste the live results (accuracy, p50 latency per task, request ids)
  in your report.

## Acceptance

- [ ] Offline tests green; live tests green and pasted in the report.
- [ ] No key ever logged (redact `Authorization` in any debug output).
- [ ] `pnpm --filter @cue/mubit typecheck` green.
