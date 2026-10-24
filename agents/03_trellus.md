# 03 · Trellus (`packages/trellus`)

Trellus is the dialer. Cue reads outcomes and history from it, and can also run without it ("Cue
native", our own version of the record Trellus keeps). Server-side only.

Read: `context.md` §10, `architecture.md` §6, `docs/trellus/api.txt` (the Call Data API reference, with
the full field list), `docs/trellus/openapi.json`. We have **no Trellus key** yet: build against the
docs, with fixtures that mirror the documented shapes exactly (positional rows for session-list,
camelCase JSON for `/session` with `x-proto-as-json: true`).

Key facts from the docs: two hosts with different auth (`ext.trellus.ai` takes an `api_key` header;
`rpt-2.trellus.ai` takes `Authorization: Bearer`); `start`/`end` in Unix **microseconds** on requests,
`started_at` in **seconds** in rows; `cnf` filters are an AND of OR groups; `session-list-v6` rows are
positional arrays in `select` order; transcript columns are aligned arrays (`turn_data.texts`,
`turn_data.is_customers`, `turn_data.starts`); per-user rate limits (session list 2 req / 4 s, metric
details 4 / 4 s, session 1 / s, visible and bootstrap 2 / 4 s each); 429 → `Retry-After`; no pagination
(split windows, dedupe by `session_id`); no webhooks, no streaming.

## Build

| File | What |
|---|---|
| `src/config.ts` | `loadTrellusConfig(env)`: `apiKey`, `teamId`, `pollSeconds`, `configured` |
| `src/client.ts` | `createTrellusClient({ apiKey, teamId?, fetch?, now? })` → `{ visible(), bootstrap(), sessionList(req), metricDetails(req), session(sessionId), audioLinks(sessionId) }`. Typed requests (zod) for `SessionListRequest` (`start`, `end?`, `select`, `cnf?`, `limit?`), per-endpoint token buckets, 429 handling, bounded backoff on 5xx, error classes that keep the documented 401 meanings ("not found", "not permissioned", "not on db") |
| `src/rows.ts` | `rowsToObjects(select, rows)`; `transcriptFromRow(obj): Turn[]` (speaker from `is_customers`, `tMs` from `starts` seconds) |
| `src/dispositions.ts` | `DEFAULT_DISPOSITION_MAP` (e.g. "Demo booked"/"Meeting booked"/"Meeting set" → `meeting_booked`, "Interested"/"Follow up" → `follow_up`, "Not interested" → `not_interested`, "Gatekeeper" → `gatekeeper_blocked`, "Voicemail"/"Left voicemail" → `voicemail`, "No answer" → `no_answer`, "Wrong number"/"Wrong person" → `wrong_person`, "Call back" → `callback_requested`), `buildDispositionMap(bootstrap, overrides?)` that learns the account's exact strings, `mapDisposition(raw, map): Outcome` (case/space-insensitive, unknown → `unknown`) |
| `src/source.ts` | `interface CallSource { kind: 'trellus'\|'native'; findOutcome(q: { startedAt: number; endedAt?: number; prospect: Prospect }): Promise<OutcomeRecord \| null>; listRecent(q: { since: number; limit?: number }): Promise<ImportedCall[]> }` with `ImportedCall = { trellusSessionId: string; startedAt: number; durationMs: number; prospect: Prospect; rep: Rep; turns: Turn[]; outcome: OutcomeRecord \| null; raw: Record<string, unknown> }` |
| `src/trellus-source.ts` | `TrellusSource`: `findOutcome` matches by normalised phone (E.164-ish), else name + company, within ±10 min of start; prefers the session with the longest live duration. `listRecent` pulls `conversation_type = 1` and `dial_metric.live_duration >= 30` (docs' recommended filter) with transcript columns |
| `src/native-source.ts` | `NativeSource`: Cue is the system of record. Outcomes come from the rep (returns null so the server uses the rep's tap), `listRecent` reads from an injected store function. Also `NATIVE_DISPOSITIONS` (the list the UI offers) and `dialLink(phone): string` (`tel:` link) |
| `src/import.ts` | `importedCallToEvents(c: ImportedCall, ids: { newId }): CallEventInput[]` → `call.started` (source `import`), `turn.added` for each turn, `call.ended`, `outcome.recorded` (source `trellus`, raw strings kept) |
| `src/outcome-poller.ts` | `createOutcomePoller({ source, intervalMs, getOpenCalls, onOutcome })`: start/stop, gives up on a call after 2 h |
| `src/fixtures/*` | `FIXTURE_VISIBLE`, `FIXTURE_BOOTSTRAP`, `FIXTURE_SESSION_LIST` (6 realistic Corgi-style calls: booked, broker objection, gatekeeper block, voicemail, email brush-off, not interested, with transcripts), `FIXTURE_SESSION`, and `createFakeTrellusFetch()` that serves them with the documented headers, auth checks and a 429 every N calls |
| `src/cli.ts` | `tsx src/cli.ts check` → calls `/visible` and `/bootstrap` with `TRELLUS_API_KEY` and prints a redacted summary, or explains that no key is set |

## Tests

Offline only: client auth headers per host; µs vs s conversions; rows → objects; transcript alignment;
disposition mapping incl. account vocabulary; outcome matching (phone formats, ±10 min, ties);
429/Retry-After and token bucket timing (fake clock); import → events parse against `CallEvent` once
stamped with `seq`/`at`.

## Acceptance

- [ ] `pnpm --filter @cue/trellus typecheck && pnpm --filter @cue/trellus test` green.
- [ ] README section text (≤ 25 lines) in your report explaining how a team connects Trellus.
