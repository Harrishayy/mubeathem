# Cue: architecture

The system behind `context.md`. **§3 is the data contract, §4 the Mubit tasks, §5 the API.** Every
workstream builds to these. If code and this file disagree, fix one of them in the same change.

## 1. Shape

```
                 ┌──────────────────────────── clients ────────────────────────────┐
                 │  apps/extension (Chrome MV3, WXT)      apps/web (Vite PWA)       │
                 │  · side panel  · overbar on Trellus    · overbar app (laptop,     │
                 │  · tab audio + mic capture             phone, pop-out PiP)        │
                 │  · reads the HubSpot/Trellus contact   · practice mode, debrief,  │
                 │                                          playbook, Mubit panel    │
                 │            both render @cue/ui and parse @cue/core schemas       │
                 └───────────────┬───────────────────────────────┬─────────────────┘
                     HTTP + SSE  │  x-cue-token                  │
                 ┌───────────────▼───────────────────────────────▼─────────────────┐
                 │ apps/server (Hono on Node ≥ 22.13, node:sqlite)                  │
                 │  call pipeline: turn → features → read_moment → playbook bandit  │
                 │                 → write_line → policy check → suggestion.shown   │
                 │  post-call:     feedback + outcome → review_call → playbook      │
                 │  holds every secret; the clients never see a provider key        │
                 └──────┬───────────────────┬────────────────────┬─────────────────┘
                        │ @cue/mubit        │ @cue/trellus       │ optional
                        ▼                   ▼                    ▼
              api.mubit.ai/openai/v1   Trellus Call Data API   Exa, Sapling
              (Responses API)          (poll: dispositions,
                                        transcripts, backfill)
```

**Language and frameworks.** TypeScript end to end in a pnpm workspace, so one set of zod schemas
types the server, both clients and the model tasks.

| Part | Choice | Why |
|---|---|---|
| Contracts | zod 4 in `@cue/core` | One source of truth, parsed at every boundary |
| Server | Hono + `@hono/node-server`, `node:sqlite` | Tiny, typed, SSE built in; no native build step for SQLite |
| Model gateway | Mubit, OpenAI **Responses API** over `fetch` | Works on the starter credit; `prompt_cache_key` names the Mubit session (§4.1) |
| UI | React 19, plain CSS with tokens, `motion` | Same components render in a Shadow DOM (extension overlay), a side panel and a web page |
| Extension | WXT (MV3) | Side panel, shadow-root content UI, offscreen document for audio, HMR |
| Standalone app | Vite + React PWA, Document Picture-in-Picture for the always-on-top overbar | Cluely-style floating bar on laptops without a native shell; installable on phones |
| Tests | Vitest (units, contracts, live Mubit opt-in), Playwright (screens × viewports × themes) | |

## 2. Repo map

```
packages/core       @cue/core     taxonomy, zod schemas, call reducer, CallRecord builder, bandit, features, mascot
packages/mubit      @cue/mubit    Mubit client, the six task definitions (prompt + strict schema), telemetry
packages/trellus    @cue/trellus  Trellus Call Data API client, disposition mapping, outcome sync, backfill, "Cue native" source
packages/ui         @cue/ui       design tokens, three directions, primitives, domain components, Sprout mascot, gallery
apps/server         @cue/server   HTTP API, pipeline, store, simulator, seed script
apps/web            @cue/web      the standalone overbar app
apps/extension      @cue/extension the Chrome extension
agents/             workstream briefs (who owns what)
docs/design         design-directions page (open in a browser)
docs/mubit, docs/trellus   provider docs snapshots used to build the clients
tests/e2e           Playwright across apps
```

## 3. Data contract

All in `packages/core/src/schema`. Summary:

- **Taxonomy** (`taxonomy.ts`): `Persona`, `Receptivity` (warm/neutral/cool/cold), `Moment` (16), each
  moment's family (colour), job and win rule; `ToneSignal`s; `ProductLine`s; `PolicyVerdict`
  (Sapling's four + `unsure`); `Outcome`; `Attitude`. **Situation key** = `persona.receptivity.moment`.
- **CallEvent** (`events.ts`): an append-only log per call. `call.started → brief.ready → turn.added* →
  situation.read → suggestion.shown | suggestion.skipped → suggestion.action* → policy.checked* →
  call.ended → outcome.recorded → feedback.submitted → review.completed → playbook.updated`.
  `pipeline.error` is emitted instead of throwing. The store stamps `seq` (per call, from 1) and `at`.
- **CallView** (`api.ts`): `reduceCall(events)` → what the UI renders. Pure, shared by server and clients.
  `updatedAt` (the latest event's `at`) and `PolicyCheck.at` let time-based UI state (the mascot's
  "card under 6 s old", "violation in the last 8 s") be computed without reading the clock.
- **CallRecord** (`tasks.ts`): `buildCallRecord(events)` → the structured record of one call: transcript,
  situation timeline with tone and features, every suggestion with the rep's actions and latency,
  policy checks, receptivity trend, outcome (with raw Trellus strings), the rep's debrief, Trellus
  fields. This is what `review_call` reads and what `GET /api/export.jsonl` writes.
- **Suggestion** latency fields (optional, §5.3): `stage` (`instant` | `refined`), `refinedAt`,
  `refinedLatencyMs`, `precomputed` (`standby`). A refined card re-uses the instant card's `id`;
  `latencyMs` is always the first version's.
- **PlaybookLine**: a line with per-situation `LineStats` (`shown, used, stepWins, booked, lost`) and a
  status (`active | candidate | retired | rejected`).

Rules:

- Ids: `call_`, `turn_`, `sug_`, `line_` + a ULID-ish (`newId(prefix)` in core).
- Times are epoch ms; offsets within a call are `tMs` from call start.
- New optional fields are safe. Renames are not. Never rename a taxonomy value.

## 4. Mubit

### 4.1 How calls are sent

- `POST {MUBIT_BASE_URL}/responses` with `Authorization: Bearer $MUBIT_API_KEY`.
- `store: false` (the starter credit refuses `store`, and Chat Completions refuses `metadata` without it).
- **Session = phone call**: `prompt_cache_key: <callId>`. Mubit takes the session from
  `prompt_cache_key` on the Responses API (docs/mubit/llms-full.txt, "Group a conversation's calls
  into a session"). Seeding and practice calls use their own call ids.
- **Task = fixed instructions + fixed schema + fixed model.** Instructions are constants in
  `packages/mubit/src/tasks/<task>.ts`. Everything call-specific goes in `input` as JSON. Never
  interpolate names into instructions (that splits the task).
- Output: `text.format = {type: 'json_schema', strict: true, name: <task>, schema}` generated from the
  zod output schema in core (optional → nullable, all keys required, `additionalProperties: false`).
- Read `x-middleware-request-id` from every answer and attach it to the event it produced. That is the
  link from a suggestion (and its later outcome) back to the exact Mubit request.
- Models: `CUE_MODEL_FAST` (default `gpt-4o-mini`) for `read_moment`, `check_claim`,
  `simulate_prospect`; `CUE_MODEL_WRITE` (default `gpt-4.1-mini`) for `write_line`,
  `research_brief`, `review_call`, `synth_brief`. Both are on the starter credit's list.
- Errors: honour `x-should-retry: false`; on 429/503 wait `retry-after`; at most 2 retries; a global
  semaphore (`CUE_MUBIT_CONCURRENCY`) because the starter credit caps calls in flight. Timeout
  `CUE_MUBIT_TIMEOUT_MS`. Every failure falls back to the rules engine and says so (`servedBy: 'rules'`).

### 4.2 Tasks

| Task | When | In → out |
|---|---|---|
| `read_moment` | every final prospect turn | transcript window + features + CRM + previous read → persona, receptivity (+score), moment, tone, signals, should_suggest |
| `write_line` | when `should_suggest` | situation + top playbook lines with stats + hooks + recent turns → say, why, line_id, up_next, risky_claim |
| `research_brief` | call start | CRM facts + Exa findings → summary, hooks (tagged with product), opener, persona guess |
| `check_claim` | rep turns that make a claim; risky suggestions | claim + policy + evidence → Sapling verdict, rule, rephrase |
| `review_call` | after feedback or outcome | the full **CallRecord** + playbook context → lines used (similarity, step win), candidate lines, missed moments, what worked/didn't, attitude, coaching, suggestion impact |
| `simulate_prospect` | practice mode, seeding | persona + mood + transcript → reply, intended moment, mood now, ends call, books meeting |
| `synth_brief` | Corgi Brief panel (`apps/brief`), when a dial connects | company + domain + raw snippets and filings as text → trigger, blurb, kind/does/targeting, employees/founded/city/stage/valuation, people, risk, 2-3 policies from the fixed Corgi list. Instructions are the panel's former Gemini prompt (SYNTH + policy list), verbatim; served by `POST /api/brief/synth` |

### 4.3 What we send so Mubit learns what works

The goal is that every recurring task's examples carry the signal of what books meetings:

1. `write_line` inputs carry the playbook's **ranked lines with their outcome stats**, so the examples
   Mubit keeps show the model choosing between lines that are known to win. As the bandit improves,
   the adapter's training inputs improve.
2. `review_call` input is the **whole labelled call**: rep debrief (rating, customer attitude, what
   worked, what didn't, better line), the outcome with its source, every suggestion with used/ignored/
   edited and latency, the tone timeline. Its output is a structured lesson. This is the task whose
   adapter learns to judge calls the way this team does.
3. Corrections are first-class events: `suggestion.action` (`edited` with the rep's text,
   `thumbs_down`), the debrief's `betterLine`, and a manager approving or rejecting a candidate line.
   They feed the next calls' `write_line` inputs (new candidates, stats) and every `review_call`.
4. `simulate_prospect` emits `intended_moment`, a weak label we compare with `read_moment` in tests.

Mubit's docs show no public feedback endpoint today; ratings in the console are set by hand. The
server keeps `(mubitRequestId → outcome)` pairs in the `mubit_links` table and exports them, ready
for an outcome-weighted training hook (context.md §13, "Training on outcomes").

### 4.4 What we send Mubit, and what we keep

Mubit gets, per call: the task's fixed instructions, the input JSON, the strict output schema, the
model and the session (`prompt_cache_key = callId`). With `CUE_MUBIT_RECORD=metadata` it is told
(`x-middleware-record: metadata`) to keep no request or answer text.

Mubit has no trace-export API (its docs only cover importing traces *from* Langfuse, Braintrust or
Logfire), so the server owns the trace store. `ModelRunner.run()` (`apps/server/src/services/models.ts`)
records a `MubitTrace` (`api.ts`) for every success, failure and timeout, and for a cancelled run only
when the request really went out (the same rules as `mubit_calls`); a missing key records nothing.
Each trace carries the request id, task, model, session/call, `instructionsVersion` (the task def's
`version` in `packages/mubit`), latency, attempts, tokens, cost, the input JSON and the parsed output.
`TelemetryStore.link` also stamps the trace with its call and suggestion ids.

- Table `mubit_traces` (migration 2), indexed on `at`, `(task, at)`, `session_id`, `request_id`, `call_id`.
- Non-blocking: `record`/`link` only queue in memory; `TraceStore` flushes in one transaction every
  250 ms or 50 queued items (`CUE_TRACE_FLUSH_MS`, `CUE_TRACE_FLUSH_ROWS`), on server close and on
  process exit. A failed flush is logged, never thrown into the pipeline.
- Bodies are JSON text capped at `CUE_TRACE_MAX_BODY_BYTES` (64 KB) per field; a longer body is kept as
  a string prefix and the row is marked `truncated`. Under `CUE_MUBIT_RECORD=metadata` no bodies are
  kept locally either. `CUE_TRACE_RETENTION_DAYS` (default 0 = forever) prunes on boot.
- Reads (`/api/traces`, `/api/insights`, export) flush first, so they always see the latest calls.

## 5. API (`apps/server`, default `http://localhost:8787`)

`POST /api/calls` takes an optional `contactId`: the server fills the prospect from the saved contact (typed fields win), stamps the contact's last call and links the call to it.

Pre-call research (`pipeline/research.ts`): with `EXA_API_KEY` and/or `VALYU_API_KEY`, Exa (company, last-180-day news, person; the work-email domain narrows the company search) and Valyu (company news and web, person) run in parallel with a per-provider timeout, merge alternately, drop repeat pages, and cache per person (`CUE_RESEARCH_CACHE_MINUTES`). The findings plus CRM facts go to `research_brief`; each hook carries `via` and `url` of the page it came from, and the brief lists its `sources`. A provider failing just contributes nothing.


Every body is parsed with the matching schema in `packages/core/src/schema/api.ts`. Errors are
`ApiError`. Auth: `x-cue-token` when `CUE_API_TOKEN` is set. CORS for `CUE_ALLOWED_ORIGINS`.

| Method + path | Body → response |
|---|---|
| `GET /health` | `HealthResponse` |
| `POST /api/calls` | `CreateCallRequest` → `CallView` (starts the brief in the background) |
| `GET /api/calls?repId=&outcome=&status=&q=&contactId=&source=&debriefed=1&from=&to=&limit=&offset=` | `CallSummary[]` (with rep, rating, attitude, what went well / badly, review summary). `x-total-count` header for paging. `outcome=none` = no outcome yet |
| `GET /api/team?from=&to=&weeks=` | `TeamResponse`: per rep calls, connected, booked, booking rate, cues shown/used, avg rating, avg cue impact, debriefed, weekly trend; plus team totals. Practice and imported calls are left out |
| `GET /api/contacts?q=&ownerRepId=&limit=&offset=` | `ContactListResponse` (`{items, total}`), most recently called first |
| `POST /api/contacts` · `PUT /api/contacts/:id` · `GET` · `DELETE` | `ContactInput` → `Contact`. Email is unique (case-insensitive); 409 on a clash |
| `POST /api/contacts/import` | `ContactImportRequest` (CSV ≤ 2 MB, header row; aliases like "Full Name", "Job Title"; other columns become facts; an existing email updates) → `ContactImportResponse` |
| `POST /api/research/warm` | `{contactId}` or `{prospect}` → 202 `{configured, providers}`. Runs Exa + Valyu now and caches the findings, so the call's brief doesn't wait on the web |
| `POST /api/research/brief` | Same body → `{brief, configured, providers}`. The brief before the call (research + `research_brief`, or the rules brief), cached per person for `CUE_RESEARCH_CACHE_MINUTES`; the call's `brief.ready` reuses it, so the rep reads one brief from dialling to wrap-up |
| `POST /api/brief/synth` | `SynthBriefRequest` (`{company, domain, sources}`) → `SynthBriefResponse` (`{output, requestId, model, latencyMs}`): `synth_brief` through Mubit for the Corgi Brief panel. 503 `not_configured` without a Mubit key, 504 `timeout` over its 8 s budget, 502 on any other model failure |
| `GET /api/calls/:id` | `CallView` |
| `GET /api/calls/:id/stream` | SSE. First `view` (a `CallView`), then one `event` per `CallEvent`. Heartbeat comment every 15 s. `Last-Event-ID` resumes from a seq |
| `POST /api/calls/:id/turns` | `AddTurnRequest` → `202 {turnId}`. Final prospect turns run the pipeline; final rep turns run the claim check and usage matching |
| `POST /api/calls/:id/suggestions/:sid/action` | `SuggestionActionRequest` → `204` |
| `POST /api/calls/:id/end` | `EndCallRequest` → `CallView` |
| `POST /api/calls/:id/feedback` | `FeedbackRequest` → `CallView` (queues `review_call`) |
| `POST /api/calls/:id/practice/next` | → `{turn, ended, booked}` the simulated prospect's reply, added as a turn |
| `GET /api/calls/:id/record` | `CallRecord` |
| `GET /api/playbook` | `PlaybookResponse` |
| `POST /api/playbook/lines/:id/approve` · `/reject` | → `PlaybookLine` |
| `GET /api/stats` | `StatsResponse` (per-task Mubit telemetry) |
| `GET /api/export.jsonl` | one `CallRecord` per line |
| `GET /api/traces?task=&callId=&ok=&before=&limit=` | `TraceListResponse`: trace summaries (no bodies), newest first; `before` = previous `nextCursor`; `limit` 1–500, default 50 |
| `GET /api/traces/:id` | `TraceDetail` (a full `MubitTrace` with input and output) |
| `GET /api/insights?range=24h\|7d\|30d\|all` | `InsightsResponse`: per-task calls/ok/failed/aborted/p50/p95/cost/tokens/errors, an hourly (24h) or daily series, and outcome insights from the event log (booking rate with vs without cues used, per-moment used/step-win/booked rates, top lines, servedBy and writePath mix, turn→card latency, review averages). Default `7d` |
| `GET /api/traces/export?format=jsonl\|openai\|langfuse&task=&range=` | Streamed download. `jsonl`: one `MubitTrace` per line. `openai`: `{messages:[system,user,assistant]}` chat fine-tune rows for successful calls with the current instructions version. `langfuse`: `{batch:[…]}` ingestion events, a `trace-create` per session and a `generation-create` per Mubit call (model, usage, input, output, start/end, `metadata.requestId`). Same code as `pnpm --filter @cue/server traces:export` |
| `GET /api/trellus/status` · `POST /api/trellus/sync` | Trellus health; pull recent sessions and match outcomes |

### 5.1 The live pipeline (per final prospect turn)

1. Append `turn.added`. Compute `TurnFeatures` in code (core).
2. If a previous turn is still being processed, the newer one wins: cancel the old (AbortController).
3. `read_moment` → `situation.read`. Rules fallback if Mubit fails or exceeds the budget.
4. If `!should_suggest` or the moment doesn't suggest → `suggestion.skipped` with the reason.
5. Bandit picks the top 3 lines for the situation (Thompson sampling on per-situation stats, backing off
   to moment-level stats, plus one exploration slot for a young line).
6. `write_line` with those candidates. If `risky_claim` or the rules pre-filter flags the line,
   `check_claim`; a `violation` swaps in the best safe line instead.
7. `suggestion.shown`. The event carries `latencyMs`. With the latency layers (§5.3) the first card
   is shown before steps 3–6 (target p50 ≤ 350 ms, p95 ≤ 500 ms after the prospect stops) and this
   step re-emits it in place.

Rep turns: rules pre-filter for claims ("definitely covered", "guarantee", a premium figure, "no
exclusions"); a hit goes to `check_claim`; a `violation` emits `policy.checked` and a compliance card.

### 5.2 After the call

`call.ended` → outcome from the rep tap, Trellus disposition (poller) or HubSpot meeting. On
`feedback.submitted` (or 10 min after end with an outcome) run `review_call` → `review.completed` →
apply to the playbook: stats for every shown line (shown, used, step win, booked/lost), candidate
lines added with `status: 'candidate'` after a policy check → `playbook.updated`.

### 5.3 Latency: a usable card within 300–500 ms

Mubit's `read_moment` (~1.6 s) and `write_line` (~1.5 s) cannot answer inside a conversational pause,
so the live path is layered. The fast layer works before any model call; Mubit refines and pre-writes.
Measured with `pnpm --filter @cue/server latency:sim` (real-time replays with interim transcripts);
numbers and the strategy log are in `docs/perf/latency.md`.

1. **Endpointing** (`CUE_EARLY_TRIGGER`). Interim prospect turns (`final: false`, stable `id`) go to
   `TurnPipeline.interim`. `endpointGuess` (core, `signals/endpoint.ts`) calls a partial finished when it
   ends in `?`/`!` or in `.` after a word a sentence can end on (Deepgram punctuates interims), or
   after `CUE_ENDPOINT_PAUSE_MS` (default 250) of unchanged text (twice that after a comma or a word
   like "and", "the", "um"). The turn then starts on the interim, before the final (which lands
   300–1000 ms after the speaker stops). The first prospect interim of an utterance also warms the
   Mubit connection (`CUE_WARM_MUBIT`: parallel `GET /models`, no model call).
2. **Instant card** (`CUE_INSTANT_CARD`). The rules read (`rulesReadMoment` + `applyIdentity`) and the
   bandit's top line are emitted at once as `suggestion.shown` with `stage: 'instant'`,
   `servedBy: 'rules'`, or `servedBy: 'cache'` + `precomputed: 'standby'` when a standby line for that
   moment and persona is ready (step 4). In process this takes a few ms.
3. **Refinement**. `read_moment` starts with the instant card; `write_line` starts speculatively on the
   card's situation (or takes over the standby write already in flight for it). When the model read
   lands, `situation.read` is emitted as before, and a Mubit version of the card may be re-emitted with
   the **same suggestion id** (`stage: 'refined'`, `refinedAt`, `refinedLatencyMs`; `latencyMs` keeps the
   first card's) — the reducer replaces a shown card with the same id, so the UI updates in place. The
   swap policy (`pipeline/latency.ts → swapDecision`):
   - never after the rep acted on the card (`suggestion.action`), never once the rep has started
     talking (any rep turn, interim or final, after this prospect turn), never more than
     `CUE_REFINE_WINDOW_MS` (default 500) after the final arrived (while the prospect is still talking
     it is always allowed), never a downgrade (model → rules);
   - same moment: upgrade the wording; identical words: re-emitted for the label only;
   - different moment: only if the instant read was weak (< 0.6), or a model read ≥ 0.6 replaces a
     rules read, or the newcomer is surer by ≥ 0.1.
   A model line that was not allowed in is **recycled** as a standby line for that moment. When the
   instant layer was quiet and the model wants a card, it appears only until the rep replies
   (`suggestion.skipped: late: rep already replying`).
   Early runs are coalesced: one run per utterance; a growing interim with the same rules moment keeps
   the run and its Mubit calls; only a change of moment restarts it (the card is replaced in place).
   The final adopts the early run when its text or rules moment matches (`CUE_EARLY_MUBIT=0` holds the
   Mubit stages until the final instead).
4. **Standby** (`CUE_STANDBY`, 0–3). After a card, Mubit pre-writes lines for the moment we are in and
   the card's `upNext` predictions, while the rep talks. Lines are screened with `findRiskyClaims` and the
   writer's `risky_claim`; each is served once, for the same persona, within 3 prospect turns / 2 min.
   Each is an ordinary `write_line` call (traced, same instructions); its `lastProspectTurn` is the
   predicted `ifTheySay`.

Without a key the server runs only the rules layer (with endpointing): one `situation.read` and one card
per turn, no `stage`. `TurnPipeline.recentTimings()` records per turn: early or not, `instantMs`, what
served the instant card, and what happened to the refinement (`swapped: upgrade`, `kept: rep_speaking`…).

UI contract: render `current` as before; when a `suggestion.shown` arrives for the id on screen, update
the text in place (no enter animation); `stage: 'instant'` with `view.pending` true can show a quiet
"refining" hint. Clients should lock the card (ignore same-id updates) as soon as their own VAD hears the
rep, since the server only learns it from the rep's first interim (~300–700 ms later).

### 5.4 The live path without rules (`CUE_PIPELINE=live`)

`pipeline/live.ts`. One streamed `live_cue` call through Mubit per prospect turn reads the moment and
writes the line together; there is no rules read and no rules card. Mubit task: fixed instructions,
the strict `LiveCueOutput` schema (keys in streaming order: `say`, `line_id`, `meaning`, `moment`,
`persona`, `receptivity`, `why`, `up_next`, `risky_claim`: the line first, so the card goes up on it), model `CUE_LIVE_MODEL` over the
Responses API with `stream: true`.

1. **Trigger.** An interim that looks finished (`endpointGuess`) starts the run; the final adopts it
   when the words match (`sameUtterance`), else restarts it. A newer turn supersedes the one in flight.
   With `CUE_SPECULATE_WORDS=n` (4 on Modal) the run starts on the growing interim once it has `n` words,
   while the prospect is still talking. A run in flight is never cut short: newer words (interim or final)
   wait in `pending` and run as soon as it finishes, updating the same card in place.
2. **Input** (`LiveCueInput`), stable prefix first so the provider can cache it: prospect, rep, the
   brief (the client's Corgi Brief when it sent one: risk, policies, verified filing lines), the call's
   playbook draw (top 2 lines per suggesting moment by Thompson sampling, drawn once per call and again
   if the persona changes), previous read, the whole call so far (up to 80 turns), lines already shown,
   and `last_response` (the prospect's last turn, possibly still being spoken). The brief is trimmed to the
   essentials (summary, risk, up to 3 policies, 6 facts); it lands a few seconds into the call (Exa runs
   from the moment Trellus connects), so the first turns may go without it.
3. **Card.** `onFields` sees each top-level string field as it completes in the stream; when `say` is
   complete (and not empty, quiet or risky) the card goes up at once. When the answer finishes,
   `situation.read` is emitted and the same card id is re-emitted with `why`, `up_next` and evidence.
   Once the rep speaks or acts, the words never change.
4. **Policy.** `risky_claim` or the claim pre-filter → `check_claim` before anyone sees it; a violation
   swaps in a safe playbook line for the moment.
5. **Failure** → `pipeline.error` and no card (there is no rules fallback on this path). A line the model
   wrote itself carries `lineId: line_none`, so it never skews a playbook line's stats.
6. **Predicted replies** (`CUE_PREDICT=n`, 0 = off). After a card, while the rep says it, the first `n`
   of its `up_next` replies each get a `live_cue` run with that reply as the prospect's turn, and one
   `/embeddings` call (`text-embedding-3-small`, 900 ms timeout) embeds the replies. When the prospect
   starts talking, their interim (from `CUE_PREDICT_MIN_WORDS`, up to 3 tries as it grows) is embedded
   and matched by cosine (`CUE_PREDICT_MATCH`, default 0.6). A match shows that reply's line at once
   (timings `predicted: true`); the real run on the full sentence refines the same card in place until
   the rep speaks. Risky or quiet predictions are never shown early.

The client may research for itself: `POST /api/calls` with `clientBrief: true` skips the server's
brief, and `PUT /api/calls/:id/brief` (a `Brief`, optionally with `corgi`) emits `brief.ready`.
`CUE_AUTO_ACTIVATE=1` lets a candidate line from a call that went well join the playbook as a young
line once `check_claim` says `supported`. Latency end to end (rep's side of the wire):
`pnpm --filter @cue/server latency:live -- --url=…` (`src/scripts/live-latency.ts`).

Hosting: `deploy/modal/app.py` runs the bundled server (`pnpm --filter @cue/server bundle`) in one
always-warm Modal container in eu-west (requests also routed through eu-west), next to Mubit's gateway
and Deepgram's EU endpoint. SQLite lives on local disk and is copied to a Modal Volume every 30 s and on
shutdown.

## 6. Trellus

Trellus is the dialer and stays unchanged. Its public API is the **Call Data API**
(docs/trellus/api.txt, openapi.json): read-only reporting over `ext.trellus.ai` (`api_key` header)
and `rpt-2.trellus.ai` (`Authorization: Bearer`). There are **no webhooks and no streaming**, so:

- **Live** audio and transcript come from Cue itself (extension: tab audio + mic).
- **Outcomes** come from polling `session-list-v6` for sessions after the call started and matching by
  customer phone/name and start time; `user_log.disposition` maps to `Outcome` via the account's
  `/bootstrap` vocabulary (`packages/trellus/src/dispositions.ts`), with raw strings kept.
- **Backfill**: `pnpm --filter @cue/server seed --from-trellus` pulls past sessions with transcripts
  (`turn_data.texts`, `turn_data.is_customers`, `turn_data.starts`), turns each into a `CallRecord`
  and runs `read_moment` over its prospect turns and `review_call` over the whole call, so the team's
  history becomes Mubit training data on day one.
- Keys stay on the server. Rate limits are per user (session list 2 req / 4 s, session detail 1 req/s):
  the client has a token bucket per endpoint.

**Cue's own Trellus.** `CallSource` is an interface (`packages/trellus/src/source.ts`) with two
implementations: `TrellusSource` (above) and `NativeSource`, where Cue owns the call record end to
end (its own dispositions, its own transcript, a `tel:`/softphone dial link). The server uses
whichever is configured; with no Trellus key it runs native.

**Configured through Trellus.** The extension detects Trellus on the page, reads the dialled contact
from the Trellus/HubSpot DOM, and the settings screen takes the Trellus key (sent to the server once,
stored server-side). Disposition mapping is editable in settings.

## 7. Clients

- **Overbar** (both apps): a pill bar pinned to the top of the screen (Cluely-style). Collapsed:
  Sprout, live timer, moment chip, the line (one line, truncates with fade), receptivity meter, expand.
  Expanded: the card, up next, drawers (brief, transcript, flags). On phones the expanded view is a
  bottom sheet.
- **Side panel** (extension): the expanded view as a column, plus debrief after the call.
- **Debrief**: outcome (required), rating, customer attitude, what worked, what didn't, better line,
  helpful/unhelpful per card. One screen, keyboard first, ≤ 20 s to complete.
- **Playbook**: lines per moment with evidence, candidates waiting for approval.
- **Model panel**: per-task calls sent to Mubit vs the 25-example adapter threshold, latency, cost,
  last request id. The demo's "your model is growing" moment, with Sprout growing a leaf per task.

## 8. Failure behaviour

| Fails | What happens | Shown as |
|---|---|---|
| Mubit down / slow | rules engine for read + bandit's top line verbatim | card footer "rules" in debug, Sprout neutral |
| Trellus key missing or 401 | native source; outcome from rep tap | settings shows "Trellus not connected" |
| SSE drops | client reconnects with `Last-Event-ID`, then refetches the view | "Reconnecting…" pill |
| Server unreachable | clients show offline state; extension keeps the transcript locally and replays it | banner |
| Mic/tab capture denied | typed turns still work | inline prompt with a retry |

## 9. Privacy

Consent banner before capture; recording consent is the rep's responsibility per state/country. Cue
reads receptivity from words and turn shape only. Secrets live in `.env` on the server.
`x-middleware-record: metadata` is sent when `CUE_MUBIT_RECORD=metadata` for teams that must not keep
transcripts in Mubit (training then can't use those calls).
