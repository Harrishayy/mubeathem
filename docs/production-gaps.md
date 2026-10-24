# Cue: what's missing for a production sales team

Where Cue stands after the contacts / team / research work, and what's still needed to run it for any
sales team at scale. Each gap is ranked by what breaks first for a real customer.

## Done in this pass

| Area | What exists now |
|---|---|
| Saved contacts | `contacts` table, CRUD, CSV import (header aliases, upsert by email, per-line errors). Calls start from a contact; the prospect is filled server-side and the call is linked. |
| Team history | `calls` carries rep, contact, rating, attitude, cues shown/used, cue impact (migration 4, backfilled). `GET /api/calls` filters by rep, outcome, status, contact, source, date, text, with paging. Each row has what went well and what didn't. |
| You vs the team | `GET /api/team`: per-rep calls, connected, booked, booking rate, cue use, rating, impact, debriefs, weekly trend, plus team totals. Practice and imports excluded. |
| Pre-call research | Exa (company, 180-day news, person; email domain narrows it) and Valyu in parallel, merged, de-duplicated, cached per person, cited per hook. `POST /api/research/warm` runs it when a contact is picked, so the brief doesn't wait on the web. |
| Traces | Every Mubit call traced (buffered), exportable as jsonl / OpenAI fine-tune / Langfuse. |

## P0: needed before a second team uses it

1. **Identity and auth.** Today one shared `CUE_API_TOKEN` (or none). Needs per-user sign-in (Google / Microsoft SSO via OIDC), sessions for the web app, and a per-user token for the extension. The rep on a call must come from the session, not from the client body (right now any client can claim any `rep.id`, which makes team stats spoofable).
2. **Tenancy.** Everything is one workspace. Add `org_id` to calls, contacts, playbook lines, traces and settings; scope every query; one Mubit `prompt_cache_key` namespace and one playbook per org.
3. **Roles.** Rep (own calls, own numbers, team leaderboard), Manager (all reps' calls and debriefs, approve playbook lines, coach), Admin (keys, integrations, retention). Today anyone can approve playbook lines and see every call.
4. **Recording consent.** Two-party-consent states and the EU need a disclosure. Add a per-org consent policy (announce / beep / none by region), a consent flag on `call.started`, and refuse transcription without it.
5. **Postgres.** `node:sqlite` is single-writer and single-node. Move the event log, projections and traces to Postgres (same SQL shapes; `json_extract` → `->>`), keep the append-only event model, and run more than one server instance behind a load balancer. SSE fan-out then needs Postgres `LISTEN/NOTIFY` or Redis pub/sub across instances.

## P1: needed for a team to rely on it daily

6. **CRM sync.** Contacts are local. Two-way sync with HubSpot / Salesforce: import contacts and lists, write the call outcome, notes, review summary and next step back as an activity, de-dupe by CRM id. Trellus dispositions already flow in; HubSpot meetings should mark `meeting_booked` with the highest trust (the outcome-trust ladder already supports it).
7. **Background jobs.** Reviews, research warm-ups, Trellus polling and trace flushing run in-process. Move to a queue (pg-boss on Postgres, or BullMQ) so a restart doesn't drop a review and work spreads across instances.
8. **Rate limits and cost caps.** Per-user and per-org request limits on the API; a monthly Mubit / Exa / Valyu spend cap per org with alerts (spend is already traced per call, so the numbers exist).
9. **PII and retention.** Transcripts contain personal data. Per-org retention (delete transcripts after N days, keep labels and stats), redaction of phone numbers / card numbers before anything leaves the server, data export and deletion per contact (GDPR / CCPA requests), encryption at rest for the database.
10. **Observability.** Structured logs exist; add metrics (turn→card latency p50/p95, Mubit error rate, SSE connections, queue depth), tracing (OpenTelemetry), uptime checks and alerting. Insights already computes latency from traces; expose it to Prometheus.
11. **Coaching loop for managers.** Team screen shows numbers; managers also need to listen back (if recordings are allowed), comment on a call, assign a line to practise, and see each rep's trend against their own baseline.

## P2: scale and polish

12. **Multi-region and latency.** Put the server near the reps (and Mubit's region); the live path budget is 3–500 ms for the first card (see `docs/perf/latency.md` once the latency work lands).
13. **Playbook governance.** Versioned playbooks, A/B of lines per segment, rollback, and an audit log of who approved what.
14. **Extension distribution.** Chrome Web Store listing, managed install via Google Workspace admin, auto-update, and org-pinned server URL so reps don't type it.
15. **Desktop overlay.** For reps who dial outside Chrome (Aircall, Zoom Phone desktop): an Electron / Tauri always-on-top overlay using the same client package. About a day of focused work for a first version.
16. **Accessibility and localisation.** The UI meets the AA contrast and keyboard rules; add i18n for copy and non-English transcription.
17. **Billing.** Seats per org, usage metering from the trace table.

## Suggested order

P0 1–3 together (auth, org, roles) since they touch every query; then 5 (Postgres) before onboarding a second customer; 4 (consent) before any calls in regulated regions; then CRM sync and jobs.
