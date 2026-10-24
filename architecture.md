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
  `research_brief`, `review_call`. Both are on the starter credit's list.
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

## 5. API (`apps/server`, default `http://localhost:8787`)

Every body is parsed with the matching schema in `packages/core/src/schema/api.ts`. Errors are
`ApiError`. Auth: `x-cue-token` when `CUE_API_TOKEN` is set. CORS for `CUE_ALLOWED_ORIGINS`.

| Method + path | Body → response |
|---|---|
| `GET /health` | `HealthResponse` |
| `POST /api/calls` | `CreateCallRequest` → `CallView` (starts the brief in the background) |
| `GET /api/calls?limit=` | `CallSummary[]` |
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
7. `suggestion.shown`. Target ≤ 1.5 s from turn to card on `gpt-4o-mini` + `gpt-4.1-mini`; the event
   carries `latencyMs`.

Rep turns: rules pre-filter for claims ("definitely covered", "guarantee", a premium figure, "no
exclusions"); a hit goes to `check_claim`; a `violation` emits `policy.checked` and a compliance card.

### 5.2 After the call

`call.ended` → outcome from the rep tap, Trellus disposition (poller) or HubSpot meeting. On
`feedback.submitted` (or 10 min after end with an outcome) run `review_call` → `review.completed` →
apply to the playbook: stats for every shown line (shown, used, step win, booked/lost), candidate
lines added with `status: 'candidate'` after a policy check → `playbook.updated`.

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
