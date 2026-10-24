# 04 · Server (`apps/server`)

The one process that holds secrets, runs the call pipeline and serves both clients.

Read: `architecture.md` (all of it; §5 is your spec), `context.md` §5–§8, `agents/01_core.md`,
`agents/02_mubit.md`, `agents/03_trellus.md` (the interfaces you call; those packages are being built
in parallel right now: code against the signatures in the briefs, through `src/adapters/*.ts`, and
re-run when they land).

## Build

| Path | What |
|---|---|
| `src/config.ts` | Env (see `/.env.example`): port, db path (expand `~`), allowed origins (supports `chrome-extension://*`), API token, models, Trellus, Exa, Sapling |
| `src/store/db.ts` | `node:sqlite` (`DatabaseSync`), WAL, migrations table. Tables: `calls` (id, status, source, started_at, ended_at, prospect_json, rep_json, trellus_session_id, outcome), `events` (call_id, seq, type, at, json; PK call_id+seq), `playbook_lines` (id, json, updated_at), `mubit_calls` (request_id, task, model, session_id, ok, latency_ms, in_tok, out_tok, cost_usd, at, error_code), `mubit_links` (request_id, call_id, suggestion_id, task) |
| `src/store/events.ts` | `append(callId, input: CallEventInput): CallEvent` (stamps seq/at in a transaction, validates with `CallEvent.parse`), `list(callId, afterSeq?)`, in-process pub/sub per call |
| `src/store/playbook.ts` | load/save lines; seeds `SEED_PLAYBOOK` on first run |
| `src/pipeline/turn.ts` | architecture §5.1 exactly. Per-call queue: a newer final prospect turn aborts the in-flight one (AbortController). Every stage timed; budget 2.5 s for read, 3 s for write, then rules fallback. Emits events only through the store |
| `src/pipeline/rep-turn.ts` | claim pre-filter → `check_claim` (or Sapling when `SAPLING_URL`) → `policy.checked` + compliance suggestion on violation; usage matching of the rep's words against the current card (`matchUsage`) → `suggestion.action used` automatically when score ≥ 0.6 |
| `src/pipeline/brief.ts` | on call start: Exa search when `EXA_API_KEY` (company + person, highlights), else CRM facts → `research_brief` → `brief.ready`. Never on the live path |
| `src/pipeline/review.ts` | §5.2: build `CallRecord`, `review_call`, apply to playbook, policy-check candidate lines, `playbook.updated`. Idempotent (re-review replaces) |
| `src/pipeline/practice.ts` | `simulate_prospect` for practice calls: persona from the request, mood drifts with the conversation, appends the prospect turn (via `sim`) and runs the normal pipeline on it |
| `src/sapling.ts` | optional `POST {SAPLING_URL}` `{claim, policy, evidence}` → verdict; any failure → Mubit `check_claim` |
| `src/http/app.ts` | Hono app with every route in architecture §5, zod-validated bodies (400 with `ApiError`), CORS, token auth, request ids, JSON error handler, body size limit 64 KB |
| `src/http/sse.ts` | `GET /api/calls/:id/stream`: `view` snapshot then `event`s, `id:` = seq, `Last-Event-ID` resume, 15 s heartbeat, cleans up on abort |
| `src/trellus.ts` | wires `TrellusSource`/`NativeSource` + outcome poller for ended calls without an outcome |
| `src/main.ts` | boot, graceful shutdown (SIGINT/SIGTERM: stop poller, close SSE, close db) |
| `src/scripts/seed.ts` | `pnpm seed [--calls 30] [--concurrency 3] [--from-trellus] [--dry]`: runs full practice calls (simulated prospect × varied personas/moods/objections from a seeded matrix) through the real pipeline and review, so **each Mubit task passes the 25-example threshold** (read_moment and write_line get many per call; research_brief and review_call one per call, so ≥ 26 calls). Prints a per-task table at the end. Default run must stay cheap: estimate and print the cost before starting, abort if the estimate is > $1 unless `--yes` |

## `@cue/client` (`packages/client`, you own it too)

The browser-safe client both apps use (no Node APIs). Build it as soon as the routes exist.

| File | What |
|---|---|
| `src/api.ts` | `createCueApi({ baseUrl, token?, fetch? })` → one typed method per route in architecture §5 (`health`, `createCall`, `listCalls`, `getCall`, `addTurn`, `suggestionAction`, `endCall`, `feedback`, `practiceNext`, `getRecord`, `playbook`, `approveLine`, `rejectLine`, `stats`, `trellusStatus`, `trellusSync`, `setTrellusKey`), parsing every response with the core schema; `CueApiError` with `code`, `status`; 10 s timeout |
| `src/stream.ts` | `subscribeCall(api, callId, { onView, onEvent, onConnection })` → unsubscribe. Uses `EventSource` (injectable), reconnects with backoff 0.5→8 s, resumes from the last seq, refetches the view after a reconnect, applies events with core `applyEvent`, exposes `connection: 'live'\|'reconnecting'\|'offline'` |
| `src/transcriber.ts` | `interface Transcriber { start(): Promise<void>; stop(): void; on(ev: 'turn'\|'level'\|'error'\|'state', cb) }`, `WebSpeechTranscriber` (Web Speech API, interim + final, auto-restart on `end`, speaker set by the caller), `TypedTranscriber` |
| `src/buffer.ts` | `TurnBuffer`: queue turns while the server is unreachable, replay in order with their original ids (server dedupes by turn id) |

Tests with a fake fetch and fake EventSource: parse errors, reconnect/resume, buffer replay order.
Also add the route `POST /api/trellus/key` (`{apiKey, teamId?}` → status; stored server-side in the db `settings` table, never echoed back).

## Tests (`test/`)

- Route tests with `app.request()` and a fake Mubit (inject a `MubitClient` stub) and an in-memory db
  (`:memory:`): create → turns → suggestion.shown with evidence → action → end → feedback → review →
  playbook stats changed. Validation errors return `ApiError`. Auth/CORS.
- Pipeline robustness: 5 prospect turns in 200 ms → only the last produces a card, earlier ones are
  `suggestion.skipped` "superseded"; Mubit timeout → rules card labelled `servedBy: 'rules'`; Mubit
  bad output → fallback; 20 concurrent calls don't cross events; very long turn (4000 chars) is
  windowed; unicode/emoji text; a rep claim "that'd definitely be covered" → compliance card.
- SSE: snapshot + events in order, resume from Last-Event-ID, heartbeat.
- Replay: `reduceCall(store.list(id))` equals `GET /api/calls/:id`.
- Live (`MUBIT_LIVE=1`): one practice call end to end (≤ 25 Mubit calls), print latency per stage and
  the request ids. Paste results in your report.

## Acceptance

- [ ] `pnpm --filter @cue/server typecheck && pnpm --filter @cue/server test` green; `pnpm --filter @cue/server build` produces `dist/main.js` that boots.
- [ ] `pnpm dev:server` boots with and without `MUBIT_API_KEY`; `/health` truthful.
- [ ] Live practice call result pasted. Do **not** run the full seed (the lead runs it); run `seed --calls 2` to prove it works and paste its table.
