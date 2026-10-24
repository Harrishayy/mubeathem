# Workstreams

`architecture.md` split into seven workstreams that build in parallel against fixed contracts.
Read `context.md` (the product), `architecture.md` (the system), then your brief.

| # | Brief | Owns | Wave |
|---|---|---|---|
| 01 | [Core logic](01_core.md) | `packages/core/src/**` except `schema/` and `taxonomy.ts` (additive edits allowed, see rules) | 1 |
| 02 | [Mubit tasks](02_mubit.md) | `packages/mubit/**` | 1 |
| 03 | [Trellus](03_trellus.md) | `packages/trellus/**` | 1 |
| 04 | [Server](04_server.md) | `apps/server/**`, `packages/client/**` | 1 |
| 05 | [Design system](05_design_system.md) | `packages/ui/**`, `docs/design/**`, `tests/e2e/ui*` | 1 |
| 06 | [Web overbar app](06_web.md) | `apps/web/**`, `tests/e2e/web*` | 2 |
| 07 | [Chrome extension](07_extension.md) | `apps/extension/**` | 2 |

Integration, README, root config and the final pass are owned by the lead.

## Ground rules

- **Stay in your files.** If you need something another workstream owns and it isn't there yet, code
  against the interface in its brief through one local adapter file (e.g. `apps/server/src/adapters/core.ts`)
  with a `TODO(ws01)` comment. Don't edit their files.
- **Contracts.** `packages/core/src/schema/**` and `taxonomy.ts` are shared. You may add an *optional*
  field or a new export if you truly need it; list it under "Contract changes" in your report. Never
  rename or remove. Never add a dependency to a package you don't own; ask in your report.
- **Dependencies** are already declared and installed. If you need a new one in a package you own,
  `pnpm --filter <pkg> add <dep>` and say so in your report.
- **Secrets**: `MUBIT_API_KEY` is in the repo-root `.env` (git-ignored). Never print, log or commit it.
  Load it with `--env-file-if-exists=../../.env` or `process.loadEnvFile`. Clients never see it.
- **Cheap models only**: `gpt-4o-mini` and `gpt-4.1-mini` through Mubit. Live tests are opt-in
  (`MUBIT_LIVE=1`) and small (≤ 30 calls per run unless your brief says otherwise).
- **No fake success.** Every fallback is labelled (`servedBy: 'rules'`). Tests that need the network
  skip with a reason when it's absent.
- **Definition of done** for your package: `pnpm --filter <pkg> typecheck` and `pnpm --filter <pkg> test`
  pass, your brief's acceptance list is ticked, and your report lists what you verified by running it,
  what you couldn't, and any contract changes.
- Don't commit. The lead commits per milestone.
- Write code that reads like a real product: small modules, named exports, comments only where the
  why isn't obvious, British/plain English in UI copy, no emoji in UI chrome.
