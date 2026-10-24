# Cue: notes for agents

Cue is a live suggestion overbar for cold calls (beside Trellus, or on its own). Every prospect turn is
read into a situation (persona · receptivity · moment), the team playbook ranks the lines that book
meetings there, and a model tailors one line. Every model call goes through **Mubit**, so the recurring
tasks become trained adapters, and every call ends in a structured, labelled record that teaches it what works.

## Read first

| File | What it settles |
|---|---|
| `context.md` | The product, the experience, the demo |
| `hack.md` | Mubit hackathon brief and judging |
| `architecture.md` | The system. **§3 data contract, §4 Mubit, §5 API** |
| `agents/README.md` | Workstreams, ownership, ground rules |
| `packages/core/src/schema/*`, `taxonomy.ts` | The contracts in code |
| `docs/design/index.html` | The design system (open in a browser) |
| `docs/mubit/llms-full.txt`, `docs/trellus/api.txt` | Provider docs snapshots |

## Commands

```
pnpm i
pnpm dev               # server :8787 + web :5173
pnpm dev:ext           # extension with HMR (WXT)
pnpm check             # typecheck + test + build, all packages
pnpm test:live         # opt-in live Mubit tests (cheap models, ~30 calls)
pnpm test:e2e          # Playwright across viewports and themes
pnpm seed:mubit        # simulated calls through every task, past the 25-example adapter threshold
```

## Rules

- Contracts first: change `packages/core/src/schema` and `architecture.md` together. Optional fields are safe; renames are not.
- Mubit: Responses API, `store: false`, `prompt_cache_key = callId` (session), fixed instructions per task, strict JSON schema. Cheap models only (`gpt-4o-mini`, `gpt-4.1-mini`).
- Never put prospect-specific text in task instructions; it splits the Mubit task.
- Never throw out of the pipeline: emit `pipeline.error` and fall back to rules, labelled `servedBy: 'rules'`.
- UI: tokens only (no raw colours in components), every component in the gallery in every state, keyboard reachable, reduced motion honoured, no overflow at 320 px.
- UI is the dashboard system (see `packages/ui/src/styles/dashboard.css`). Page layout: every screen except Live is a scrolling `Board` under the sticky `AppBar`, with filters in a pinned `Toolbar`; rows are `BoardSection`s of `Pane`s with `span` (12 columns) that take their content's height (`scroll={false}`, or `'cap'` for long tables); a list beside its detail is a `Screen` that fills the window. Never split the window into stacked scrolling panes (sections shrink to two rows). Live (a fixed-height console) and the list-first History and Contacts use `cue-dash--fit`. tables are `DataTable`; figures are `Kpi`/`StatGrid`/`KeyValue`. Labels via `.cue-label` / `--font-label`, square tags not pills, moment colour only as margin rule, key and quotes. No truncation (wrap with `overflow-wrap: anywhere`), no page-level horizontal overflow at 320–1920 px. Work tied to the current screen (debrief) opens in `Dialog`, not a new route.
- Secrets stay in `.env` on the server. Clients never hold a provider key.
- Commits: no AI co-author trailers.
