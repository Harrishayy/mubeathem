# 07 · Chrome extension (`apps/extension`)

Cue beside Trellus: Chrome MV3 built with WXT + React, rendering `@cue/ui`.

Read: `context.md` §10, `architecture.md` §6–§7, `agents/05_design_system.md`, `agents/06_web.md`, and `packages/client` (`@cue/client`: the API, SSE stream,
transcriber and offline buffer; use it, don't reimplement), WXT docs (https://wxt.dev).

## Build

| Entry | What |
|---|---|
| `wxt.config.ts` | manifest: `side_panel`, permissions `sidePanel`, `storage`, `tabCapture`, `offscreen`, `activeTab`, `scripting`; host permissions for `*://*.hubspot.com/*`, `*://*.trellus.ai/*`, `*://app.trellus.ai/*`, `*://*.salesloft.com/*`, `*://*.outreach.io/*`, `*://*.apollo.io/*`, and the server origin (configurable, default `http://localhost:8787/*`); icons from Sprout; action click opens the side panel |
| `entrypoints/background.ts` | owns the call session: starts/stops capture, relays turns to the server, keeps a local turn buffer to replay when the server was unreachable, opens the side panel, keyboard commands (`Alt+Shift+C` toggle overbar, `Alt+Shift+B` booked) |
| `entrypoints/offscreen/` | offscreen document: `tabCapture` stream (prospect) + `getUserMedia` mic (rep) → `Transcriber` (pluggable: Web Speech for the mic; a streaming STT provider adapter interface for tab audio, with a Deepgram implementation behind a server-issued temporary token when `DEEPGRAM_API_KEY` is set on the server; otherwise "tab audio transcription not configured" and the rep can type/speak both sides) ; voice levels |
| `entrypoints/sidepanel/` | the inline overbar (expanded) + debrief + settings, same screens as the web app's Live/Debrief/Settings |
| `entrypoints/overlay.content/` | content script on the CRM/Trellus hosts: `createShadowRootUi` mounting `<CueRoot direction="night">` + `<Overbar placement="top">` so styles never leak either way; reads the dialled contact (HubSpot contact page: name, title, company, phone from the DOM with resilient selectors and a manual override), detects Trellus's dialer panel and call state (connected / ended) when visible, and offers "Start Cue" when a call connects |
| `src/context/hubspot.ts`, `src/context/trellus.ts` | DOM readers with fixtures (saved HTML snippets in `test/fixtures`) and unit tests |
| `src/settings.ts` | `chrome.storage.sync` settings: server URL, token, direction, theme, auto-start on Trellus connect, which hosts to show the overbar on; Trellus key is sent to the server, never stored in the extension |

## Tests

- Vitest: DOM readers on fixtures; background message routing; offline buffer replay; settings defaults.
- `pnpm --filter @cue/extension build` produces `.output/chrome-mv3` with a valid manifest (assert in a test).
- Playwright: launch Chromium with the built extension (`--load-extension`), open a local fixture page
  that mimics a HubSpot contact + Trellus panel, assert the overbar mounts in a shadow root, reads the
  contact, and survives the page's hostile CSS (`* { all: unset }` on the host page). Screenshot.

## Acceptance

- [ ] typecheck, test, build green; the extension loads unpacked with no manifest errors.
- [ ] README section in your report: install unpacked, configure server + Trellus, permissions explained.
