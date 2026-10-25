# Steward: notes for agents

Steward is a governing layer for robot fleets. For each attempt it recalls lessons, plans
through Mubit, safety-checks every phase with Banyan Sapling, acts, checks the result, and
writes a lesson when it fails. `console/` is the Next.js website that shows all of it: takes,
video, every call and what came back, failures, lessons, and the backend services.

## Map

| Path | What it is |
|---|---|
| `steward/` | The loop (`loop.py`), model calls (`model.py` Mubit, `sapling.py` Sapling, `offline.py` scripted stand-ins), tasks and prompts (`tasks.py`), lessons (`lessons.py`), event log (`events.py`), practice runs (`practice.py`), the Safety lab's experiment (`security.py`) and the evidence export (`evidence.py`) |
| `steward/EVENTS.md` | **The contract.** What every log line, call payload and take file holds. The console reads only these files. |
| `isaac/` | Isaac Sim takes on the DGX (`run_pour.py`, `pour_world.py`) |
| `sapling/serve.py` | Serves Banyan Sapling on the DGX (`SAPLING_URL`); `probe.py` scores the policy wording |
| `deploy/modal/` | Sapling and the PyBullet physics on Modal. `team.py` runs the Modal CLI with the team token from `.env` |
| `video/` | `pull.sh` copies takes from the DGX; `prepare.py` makes the player copies in `runs/web/`; the Safety lab's reels |
| `console/` | The Next.js app, run with pnpm. Services live in `src/services/<id>/` (a `server.ts` behind `/api/<id>`, plus a `client.ts`), registered in `src/services/server/registry.ts`. Panels are folders in `src/panels/`, registered in `src/panels/index.ts` and placed in `src/tabs.ts`. |
| `console/e2e/` | `smoke.py` drives the site in a browser against a real runs dir |
| `runs/` | Gitignored output: `takes/`, `web/`, `security/`, `latest.jsonl`, `practice-lessons.json` |
| `evidence/` | Real recordings committed with the repo, same layout as `runs/`, written only by `python -m steward.evidence`. The console reads it when `runs/` has no take or safety report |
| `docs/` | The Safety lab walkthroughs (`security-demo.md`) and the README's images |
| `apps/`, `packages/`, `test-results/` | Untracked leftovers of the earlier Cue product. Not part of Steward; leave them alone. |

## Commands

```bash
python -m pytest -q tests                                  # offline, no model calls
python -m steward.practice --offline --episodes 6          # whole loop, scripted stand-ins, free; never shown in the console
python -m steward.practice --episodes 40 --workers 4       # live: real Mubit calls (spends the key)
cd console && pnpm install && pnpm dev                     # http://localhost:3100
cd console && pnpm typecheck && pnpm build
STEWARD_RUNS_DIR=<real runs dir> pnpm --dir console start -p 3199
python3 console/e2e/smoke.py http://127.0.0.1:3199          # read-only; --write asks Mubit for a debrief and adds a lesson
python -m steward.evidence --take <take> --security <run>   # copy real runs into evidence/, redacted
python -m steward.evidence --check                         # no endpoint URL or credential in anything git would commit
```

## Settings

All of these live in `.env` at the repo root. Python and the console read it the same way: the real environment wins over the file.

| Variable | What it does |
|---|---|
| `MUBIT_API_KEY` | Required for live runs and Mubit debriefs. |
| `MUBIT_BASE_URL` | Mubit's gateway URL. |
| `STEWARD_MODEL` | The model Steward asks Mubit for. |
| `STEWARD_TEMPERATURE` | Optional sampling temperature for Mubit calls. |
| `SAPLING_URL` | Where Sapling answers: `sapling/serve.py` through a tunnel, or the Modal deployment. |
| `SAPLING_TOKEN` | Bearer token sent on every Sapling request. The Modal deployment refuses `/verify` without it. |
| `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | The team's Modal token, used only through `deploy/modal/team.py`. |
| `STEWARD_RUNS_DIR` | Where runs are written and read (default `<repo>/runs`; the console falls back to `evidence/` to read). |
| `STEWARD_PYTHON` | The Python the console uses to start practice runs. |
| `STEWARD_DEBRIEF_MODEL` | The model the console's debrief asks Mubit for (default `STEWARD_MODEL`). |
| `STEWARD_SERVICES_OFF` | Comma-separated console service ids to switch off. |
| `STEWARD_READ_ONLY` | `1` refuses every console POST and DELETE: set it on any console others can reach. |
| `STEWARD_ROOT` | The repo root, if the console can't find it from its working directory. |

## Changing things end to end

1. **A new field or event.** Log it in `steward/`, document it in `steward/EVENTS.md`, test it in `tests/test_events.py`, then read it in the console. Real runs are turned into console state in one place, `console/src/sources/runs/build.ts`.
2. **A new backend service.** Create `console/src/services/<id>/server.ts` exporting `service: ServerService` (routes, health, env). Add one line to `src/services/server/registry.ts`. Put the browser side in `client.ts`, using `services/http.ts`. Health checks must never make paid calls.
3. **A new panel.** Copy `console/src/panels/_template`, register it in `src/panels/index.ts`, and add `{ id }` to a tab in `src/tabs.ts`. Panels read state through `useConsole()` and change it only through `actions`.

## Rules

- Never fabricate data. The console shows only real takes: it has no demo source, and takes marked `offline` or `fixture` are never served (`isReal` in `console/src/services/runs/server.ts`, the only way takes reach `sources/runs/build.ts`; `validReport` in `services/safety/server.ts` does the same for safety reports). The task (phases, ranges, policy) comes from each take's manifest or report, never from console code.
- Nothing committed may let someone spend our credits: no keys, and no hosted endpoint URL (Modal, tunnels). Reports keep URLs out, the console strips them before serving, and `tests/test_evidence.py` fails if any file git would commit holds one. Hosted endpoints that spend money require a token (`SAPLING_TOKEN`).
- Health checks and page loads must not spend money. Only a run the operator starts may make live Mubit calls. Console writes come only from its own pages, as JSON (`refuseWrite` in `src/app/api/[...path]/route.ts`).
- Keep the safety loop fail-closed: a robot moves only on a `supported` + `decided` verdict.
- Modal deploys use the token in `.env`, never the user's own Modal CLI login.
- Commit only when asked, and never add AI co-author trailers. Don't push or rebase without asking.
