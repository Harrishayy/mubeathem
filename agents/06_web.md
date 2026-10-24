# 06 · Web overbar app (`apps/web`)

Cue as its own app: a Cluely-style overbar for laptops and phones that works with or without Trellus.
Vite + React 19 PWA, rendering `@cue/ui` and talking to `@cue/server`.

Read: `context.md`, `architecture.md` §5 and §7, `agents/05_design_system.md` (the components you use;
they exist now in `packages/ui`, run `pnpm --filter @cue/ui dev` to see them), `apps/server` routes.

## Build

| Path | What |
|---|---|
| `@cue/client` | API, SSE stream, transcriber and offline buffer come from `packages/client` (built by workstream 04). Don't reimplement them; wrap them in hooks (`src/hooks/`) |
| `src/state/` | small store (React `useSyncExternalStore`, no Redux): settings (persisted in localStorage with try/catch), current call, connection |
| `src/capture/` | uses `@cue/client`'s transcribers; adds the speaker toggle (hold Space = rep, otherwise prospect) for single-mic demos; voice level from an `AnalyserNode` for Sprout |
| `src/screens/Live.tsx` | the overbar over a calm backdrop (`placement` top on desktop, sheet on phones) + a minimal call composer (prospect fields, Start). Keyboard: `⌘/Ctrl+.` toggle expand, `U` used, `D` dismiss, `E` edit, `B` booked, `Esc` collapse |
| `src/screens/Practice.tsx` | practice mode: pick persona/mood/objections; the simulated prospect replies through `/practice/next`; optional browser TTS for the prospect's lines |
| `src/screens/Debrief.tsx` | `DebriefForm` after the call, then the review (what worked/didn't, coaching, lines credited) when `review.completed` arrives |
| `src/screens/Playbook.tsx`, `Model.tsx`, `History.tsx`, `Settings.tsx` | playbook board with approve/reject; `ModelGrowthPanel` polling `/api/stats`; past calls; settings: server URL, token, direction/theme/density, transcriber, **Trellus** (key field posted to the server, status, disposition map editor) |
| `src/pip.ts` | "Pop out" → Document Picture-in-Picture window (Chrome) rendering the inline overbar, always on top over Trellus/Zoom/any app; falls back to a small `window.open` popup |
| `src/demo/` | "Demo mode" that plays `DEMO_SCRIPT` against the real server (adds turns with natural timing), so the demo runs hands-free and identical every time |
| PWA | manifest + icons (Sprout), service worker only for the app shell (never cache API) |

Routing: hash routes (`#/live`, `#/practice`, `#/playbook`, `#/model`, `#/history`, `#/settings`, `#/debrief/:id`). Mobile nav = bottom tab bar; desktop = the overbar plus a slim left rail.

## Tests

- Vitest: api client parsing and error mapping; stream reconnect logic with a fake EventSource;
  transcriber state machine; settings persistence when storage throws.
- Playwright (`tests/e2e/web.spec.ts`, add a project to the root config): with the real server running on
  the rules engine (`MUBIT_API_KEY=` empty) start a call, add prospect turns, see a card, use it, end,
  submit debrief, see the playbook change. Viewports 320, 375, 768, 1280, 1920; light/dark; no
  horizontal overflow; screenshots to `test-results/web/` and review them.
- One live run with Mubit on (demo mode, ≤ 25 calls) and paste the per-card latencies.

## Acceptance

- [ ] typecheck, test, build green; Playwright green; screenshots reviewed.
- [ ] The full demo (context.md §11) plays end to end in demo mode against the live server.
