# Steward console

A one-viewport dashboard over Steward's real runs. It reads the takes in the runs dir
(`runs/takes/<take>.jsonl`, with their video), follows a run live while it writes, and lets
you replay any attempt to the moment something was decided, see exactly what each Mubit and
Sapling call sent and returned, debrief a failure with a model, and turn the answer into a
fleet lesson. Nothing in it is simulated: with no takes, it says so.

```bash
cd console
pnpm install
pnpm dev          # http://localhost:3100
pnpm build && pnpm start
pnpm typecheck
```

## Tabs

Each tab is its own route and fits in one viewport. Panels share their column's height,
and a collapsed panel shrinks to its header, which still shows a one-line summary.

| Tab | Route | What it is for |
| --- | --- | --- |
| Safety lab | `/safety` | The latest completed live safety report: the same proposed actions with and without Sapling, paired recordings, and every check's input, probabilities and decision. `/` opens here. |
| Fleet | `/fleet` | Every robot's take video (or practice-world scene), status, phase and recent outcomes. Click one to replay it. |
| Replay | `/replay` | Scrub an attempt, step between decisions, read the trace and the call behind each decision, and debrief it. |
| Failures | `/failures` | Every failed or stopped attempt, the lesson it wrote, what the next attempt changed, and what not to do. |
| Lessons | `/lessons` | Fleet lessons from the lesson files: what each applies to, how often it was recalled, and whether recalls then succeeded. Retire or restore one. |
| System | `/system` | Every Mubit and Sapling call and what it sent and returned, each Mubit task's latency, Sapling's health, every backend service and its settings, the takes, and starting a practice run. |

Keys `1`–`6` switch tabs. The engine lives in the root layout, so switching tabs keeps
following the runs dir and keeps your place in a replay. The Safety lab reads its own
reports, so opened first it renders without loading the takes; they load when you open
another tab.

## Adding, removing and moving panels

The layout is one file, `src/tabs.ts`, with one line per panel:

```ts
{ id: "learning-curve", grow: 1.1, minHeight: 170 },
```

- **Remove** a panel by deleting its line.
- **Move** it by moving the line to another column or tab.
- **Add** one:
  1. `cp -r src/panels/_template src/panels/<id>`
  2. Register it in `src/panels/index.ts`.
  3. Add `{ id: "<id>" }` to a column in `src/tabs.ts`.
- **Add a tab** with a new entry in `TABS`. It gets the route `/<id>`.

Per-line options:

- `title` overrides the header text.
- `grow` sets the panel's share of its column's height.
- `minHeight` is its smallest height in px while expanded.
- `collapsed` starts it collapsed.
- `props` lets one panel serve several tabs; the Lessons tab reuses `activity` this way.

Each viewer's collapse toggles are kept in `localStorage`.

A panel is a folder with an `index.tsx` that exports `meta` and a default component, plus an
optional `*.module.css`. Inside a panel:

| Hook or component | Use it for |
| --- | --- |
| `useConsole()` | Read state with `st`; change things through `actions` |
| `useTick(events, ms)` | Re-render when engine events fire (the event list is in `src/engine/store.ts`) |
| `useFrame(fn)` | Per-frame canvas or imperative work |
| `usePanel()` | Tells you when the panel is collapsed, so heavy work can stop |
| `<PanelSub>` | Fills the header's summary line |
| `<PanelActions>` | Fills the header's controls slot |

Each panel renders inside its own error boundary, so a crash shows a "Try again" card in that
panel and leaves the rest running.

## Layout of the code

```
src/
  app/            routes: /[tab] (one per tab), /api/[...path] (the services)
  tabs.ts         the layout
  panels/         one folder per panel, plus index.ts (the registry) and _template
  console/        provider, shell, panel frame, tab view, hooks
  ui/             shared pieces: Pill, Verdict, Glyph, Seg, EpisodeStrip, video and text views
  engine/         plain TypeScript, no React: task spec, timeline, playback, calls, history,
                  debrief assistant, store and actions
  sources/runs/   Steward's logs → engine state (build.ts), followed live (index.ts)
  services/       server routes under /api/<id>: runs, live, lessons, mubit, sapling, practice
  styles/         tokens.css (dark first, light mirrored), base.css, shell.css
```

The engine runs on the client only. It holds state in a mutable store outside React and
emits named events, and panels subscribe to just the events they need.

## Where the data comes from

Everything comes from the files Steward writes (the contract is `steward/EVENTS.md`):

- **Takes**: `runs/takes/<take>.jsonl`, one attempt per `attempt` event per robot. Isaac
  takes add `.mp4`, `.pov.mp4` and `.frames.json`, which put every event on the video's
  timeline. Pull them from the DGX with `video/pull.sh`, or point `STEWARD_RUNS_DIR` at a
  mounted copy. With nothing in `runs/`, the console reads the committed `evidence/`
  folder instead, and refuses to add lessons to it.
- **Safety reports**: `runs/security/<run>/report.json`, served only when it is a completed
  `live` report. Endpoint URLs and local paths are stripped before it reaches the browser.
- **The task**: phases, plan ranges, safety policy and each model task's instructions come
  from the manifest in each take's `take` event, not from the console.
- **Live runs**: `runs/latest.jsonl`, streamed as it grows.
- **Lessons**: the lesson files, read and written through `/api/lessons`.

Takes marked `offline` (scripted stand-ins from `steward/offline.py`) or `fixture` are never
served or shown. Steward's logs don't record which calls Mubit kept or whether an adapter is
serving, so the console doesn't claim either; check the Mubit console for that.

## Debrief

The debrief answers questions about the selected attempt, using only that attempt's log.
It asks a real model:

1. **Claude**, when the page runs as a claude.ai artifact with the `sample` capability.
2. **Mubit**, through `POST /api/mubit/debrief`, which keeps the key on the server.

With neither available it says so instead of answering. An answer can propose a fix as a
`FIX {...}` line, shown as a card you can add to the fleet lessons. For a practice attempt
you can also add it and start a practice run of the same size; Isaac takes are re-run on
the DGX with `isaac/run_pour.py`.

Settings come from the environment, falling back to the repo's `.env`:

| Variable | Default |
| --- | --- |
| `STEWARD_RUNS_DIR` | `<repo>/runs` |
| `MUBIT_API_KEY` | required for debriefs and practice runs |
| `MUBIT_BASE_URL` | `https://api.mubit.ai/openai/v1` |
| `STEWARD_DEBRIEF_MODEL` | falls back to `STEWARD_MODEL`, then `gpt-6-luna` |
| `SAPLING_URL` | unset: safety checks go through Mubit. Never sent to the browser. |
| `SAPLING_TOKEN` | sent as a bearer token to Sapling; required by the Modal deployment |
| `STEWARD_PYTHON` | `python3`, for practice runs |
| `STEWARD_READ_ONLY` | unset. `1` refuses every POST and DELETE: set it on a console others can reach |
| `STEWARD_SERVICES_OFF` | unset. Comma-separated service ids to switch off |
| `STEWARD_ROOT` | found from the working directory |

Every POST and DELETE must come from the console's own pages (a browser's `Origin` must
match) and every POST must be JSON, so another site can't start a paid run through your
browser. Health checks make no paid calls; Sapling's `/health` answer is reused for five
minutes, since on Modal it wakes a container.

## Smoke test

```bash
STEWARD_RUNS_DIR=<real runs dir> pnpm start -p 3199
python3 e2e/smoke.py http://127.0.0.1:3199 [screenshots dir] [--write]
```

It checks `/` opens the Safety lab, every tab fits, no endpoint URL reaches the browser, a
paired video seeks, and cross-site or non-JSON writes are refused, then replays a take.
`--write` asks Mubit for a debrief fix and adds it to the lesson files; leave it off for a
read-only pass.

## Versions

Next.js is pinned to `16.4.3`. Versions up to and including 16.4.0 are affected by
GHSA-2464-fhr4-w9xw and GHSA-673q-mjm6-r5xr (critical) and GHSA-p3m5-59mp-jv5r (high), and
`next build` refuses to run on them. Keep `pnpm audit` clean when bumping.
