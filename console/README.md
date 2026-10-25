# Steward console

A one-viewport dashboard for a fleet of robots learning in simulation. Watch every robot
live, replay any episode to the moment something was decided, ask why it failed, turn the
answer into a fleet lesson, and see what Mubit is learning from the calls.

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
| Fleet | `/fleet` | Every robot's live scene, phase, last event and recent outcomes. Click a robot to replay it. |
| Replay | `/replay` | Scrub an episode, step between decisions, read the trace and the sampled plans, and debrief it. |
| Lessons | `/lessons` | Fleet lessons: what each applies to, how often it was recalled, and whether recalls then succeeded. |
| Mubit | `/mubit` | Calls per task, kept examples, adapters, and latency before and after an adapter serves. |
| Log | `/log` | Every event as JSONL rows: filter, inspect, copy, replay that moment, open a real take. |
| System | `/system` | The design system: principles, tokens, components and the live layout map. |

Keys `1`–`6` switch tabs. The engine lives in the root layout, so switching tabs keeps the
fleet running and keeps your place in a replay.

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
  app/            routes: /[tab] (one per tab), /api/debrief
  tabs.ts         the layout
  panels/         one folder per panel, plus index.ts (the registry) and _template
  console/        provider, shell, panel frame, tab view, hooks
  ui/             shared pieces: Pill, Verdict, Glyph, Seg, EpisodeStrip, SceneCanvas, LatSpark
  engine/         plain TypeScript, no React: simulation, timeline, playback, scene drawing,
                  take import, debrief assistant, store and actions
  styles/         tokens.css (dark first, light mirrored), base.css, shell.css
```

The engine runs on the client only. It holds state in a mutable store outside React and
emits named events, and panels subscribe to just the events they need.

## The fleet

The fleet is simulated: nine robots run pour, pick-and-place and stack tasks. Each episode
mirrors Steward's own loop and writes events with the shape of `steward.log.EventLog`:

1. **recall:** lessons match when at least two `applies_to` words match.
2. **plan:** four plans are sampled and the best is picked.
3. **verify:** Sapling-style labels: `supported`, `violation`, `insufficient_information`,
   `inconsistent_context`.
4. **act**, then **check** the outcome.
5. **learn:** write a lesson.

People entering the 1 m and 2 m zones cause holds and escalations. Mubit calls build up kept
examples, and each task trains an adapter after 25 kept examples.

To look at a real run, open a take on the Log tab. That is a `runs/takes/<take>.jsonl` file
written by Steward. Its events are re-timed into episodes you can replay and debrief.

## Debrief

The debrief answers questions about the selected episode, using only that episode's log. It
tries three sources in order:

1. **Claude**, when the page runs as a claude.ai artifact with the `sample` capability.
2. **Mubit**, through `POST /api/debrief`. The route proxies to Mubit's OpenAI-compatible
   gateway and keeps the key on the server.
3. **A local read of the log**, which needs no network.

An answer can propose a fix as a `FIX {...}` line. The debrief shows that fix as a card you
can add to the fleet lessons or use to queue a re-run.

The API route reads its settings from the environment, falling back to the repo's `.env`:

| Variable | Default |
| --- | --- |
| `MUBIT_API_KEY` | required for the Mubit source |
| `MUBIT_BASE_URL` | `https://api.mubit.ai/openai/v1` |
| `STEWARD_DEBRIEF_MODEL` | falls back to `STEWARD_MODEL`, then `gpt-6-luna` |

`GET /api/debrief` reports `{ configured, model }` without calling Mubit.

## Versions

Next.js is pinned to `16.4.3`. Versions up to and including 16.4.0 are affected by
GHSA-2464-fhr4-w9xw and GHSA-673q-mjm6-r5xr (critical) and GHSA-p3m5-59mp-jv5r (high), and
`next build` refuses to run on them. Keep `pnpm audit` clean when bumping.
