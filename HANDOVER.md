# Handover: `nickmain` (Corgi Cue)

Where this branch is, what it's for, and what's next. Written 2026-10-24.

## What we're trying to do

A live cold-call copilot for Corgi BDRs that **wraps Trellus** (which wraps Twilio). While the rep
talks, it reads the transcript and shows the **one line to say next**: the line most likely to book a
meeting for this prospect, at this moment. It gets better over time: every call's outcome scores the
lines that were said, and every model call goes through **Mubit**, so the recurring task becomes a
small, fast model trained on the team's own calls.

Targets:

- **Look and feel of Corgi Brief** (the existing side panel: SEC filings, Exa research, opener, policies).
- **No regex reading the prospect.** A model reads what they meant, then writes the line.
- **Under 600 ms** from the prospect stopping to the card on screen.
- **Hosted on Modal.**

## What exists now

| Part | Where | State |
|---|---|---|
| Extension: Corgi Brief + the live call | `apps/brief` | Works. The smoke test passes in real Chromium |
| Live pipeline, one streamed model call per turn | `apps/server/src/pipeline/live.ts` | Works on Modal with real suggestions |
| `live_cue` Mubit task: reads the moment, then writes the line | `packages/mubit/src/tasks/live-cue.ts` | Works through Mubit (OpenAI route) |
| Streaming Mubit client | `packages/mubit/src/client.ts`, `stream.ts` | Works (Responses API). Has a Gemini path we no longer use (see below) |
| Learning loop | `apps/server/src/pipeline/review.ts` | Works in tests |
| Modal deployment | `deploy/modal/app.py` | Live at `https://nicholastchakov--corgi-cue-live-serve.eu-west.modal.run` |
| Latency tools | `apps/server/src/scripts/live-latency.ts`, `live-models.ts` | Work |

### The flow

```
Trellus card flips to connected   (apps/brief/content.js, inside Trellus's shadow DOM)
 ├─ brief: EDGAR Form D/C + Exa + synthesis (apps/brief/background.js, from Corgi Brief)
 │     └─ PUT /api/calls/:id/brief, so the live line knows the risk, policies and filings
 └─ POST /api/calls (clientBrief: true)
       offscreen.js: call tab audio (prospect) + mic (rep) → Deepgram → POST /api/calls/:id/turns
       server: interim looks finished → live_cue streamed through Mubit → card when `say` completes
       SSE → apps/brief/live.js renders SAY NEXT, the read, "if they say", the transcript
Trellus card ends → panel asks "How did it go?" → outcome + review → playbook stats and new lines
```

### How it learns

1. **In context:** every `live_cue` prompt carries the team playbook (the top 2 lines per moment by
   Thompson sampling) with each line's record (used, won, booked). Proven lines get preferred.
2. **After the call:**
   - the outcome scores the lines the rep actually said;
   - with `CUE_AUTO_ACTIVATE=1` (on in Modal), a line the rep improvised on a call that went well joins
     the playbook as a young line, after a policy check.
3. **Mubit:** every `live_cue` call is one Mubit task, so it builds toward a trained adapter. Still open
   with Mubit: whether adapters can be called from code, and whether training can be weighted by
   outcome. See `context.md` §13.

## Measured (`docs/perf/live-latency-2026-10-24-modal-gpt-4.1-mini.json`)

Real calls replayed in real time against Modal, measured on the rep's side of the wire:

| | |
|---|---|
| End of speech → card, median | **1491 ms** |
| p95 | 1725 ms |
| Cards under 600 ms | 29% (long turns, where the run finished before they did) |
| Network round trip (POST a turn → see it on SSE) | ~105 ms |
| Moment accuracy vs the script labels | 71% |

The line quality is good. Examples:

- "Makes sense, most founders do. When did they last re-quote you after the raise?"
- "I won't guess at a number, but the quote call gets you a real one."

**Why it isn't under 600 ms yet.** Through Mubit, even a one-sentence prompt takes ~520 ms to the first
byte, for both `gpt-4.1-mini` and `claude-haiku-4-5`. So a model call that starts after the prospect
stops can't show a card within 600 ms.

Model benchmark (`live-models.ts`), line on screen:

| Model | Median | Notes |
|---|---|---|
| `gpt-4.1-mini` | ~1.1 s | in use |
| `gpt-4o-mini` | ~1.2 s | |
| `gpt-5.5` | ~1.6 s | reasoning `none` |
| `gpt-6-luna` | ~1.7 s | reasoning `none` |

Gemini was dropped on purpose: inference goes through Mubit's OpenAI route.

**What we found about location.** Mubit is in Europe: 30 ms from Modal eu-west, 104 ms from us-east.
So the server runs in eu-west with eu-west routing, which cut a request round trip from 185 ms to
52 ms. Deepgram's EU endpoint is used too.

## Next steps, in order

1. **Get under 600 ms by having the line ready before they finish.** No regex: semantic matching.
   - After each card, use the rep's talking time to pre-write a line for each likely reply (the card's
     `up_next`). Each is one `live_cue` call with that reply as the prospect's turn.
   - When the prospect starts talking, embed their first words and compare them to the predicted
     replies. Embeddings go through Mubit's `/embeddings`: `text-embedding-3-small` took ~270–490 ms
     per call, with one outlier at 30 s, so it needs a timeout. If one matches, show its line at once.
   - Let the real `live_cue` run on the full sentence replace it in place, until the rep speaks.
   - Also start speculative runs on growing interims, not only when the sentence looks finished.
   - `pipeline/turn.ts` already has the standby/refine machinery for the old rules path to copy from.
   - Measure each change with `latency:live`.
2. **Deepgram key.** None exists yet, and Claude couldn't create a Deepgram account. Without it nothing
   transcribes in the extension (the panel shows "Transcription is not set up").
   - Create one at console.deepgram.com, then run:
     `modal secret create corgi-cue-keys MUBIT_API_KEY=… TRELLUS_API_KEY=… DEEPGRAM_API_KEY=… --force`
     and `modal deploy deploy/modal/app.py`.
   - The alternative is self-hosted streaming speech-to-text on a Modal GPU, so no third-party key.
3. **Remove Gemini from the brief.** `apps/brief/background.js` `synthBrief()` still calls Gemini
   directly (Corgi Brief's original code). Move it to a server endpoint that runs a Mubit task with the
   same prompt (`SYNTH` + `POLICY_BLURB`), so all inference goes through Mubit. Then drop the Gemini
   path in `packages/mubit/src/client.ts` (`geminiStream`) and `CUE_LIVE_PROVIDER=gemini`.
4. **Check where Trellus plays the call audio.** Cue captures the tab where the connected card appeared.
   - If Trellus plays audio elsewhere, the panel shows THEM ✗; press Alt+Shift+L on the tab that plays it.
   - Not yet tested on a real Trellus call.
5. **Moment accuracy (71%).** Mostly gatekeeper vs opener on transfers. Add examples to the `live_cue`
   instructions and bump the task `version` (a new Mubit task).
6. **Trellus outcomes.** `TRELLUS_API_KEY` is set on Modal, so the poller can fill dispositions
   automatically. Not exercised yet.

## How to run

```bash
npx pnpm@10.26.1 i
# local server: .env needs MUBIT_API_KEY (gitignored); CUE_PIPELINE=live for the new path
CUE_PIPELINE=live npx pnpm@10.26.1 --filter @cue/server dev
# deploy
npx pnpm@10.26.1 --filter @cue/server bundle && modal deploy deploy/modal/app.py
# measure (token read from .env.modal)
npx pnpm@10.26.1 --filter @cue/server latency:live -- --url=https://nicholastchakov--corgi-cue-live-serve.eu-west.modal.run
# models
cd apps/server && npx tsx --env-file=../../.env src/scripts/live-models.ts gpt-4.1-mini gpt-4o-mini
# tests
npx pnpm@10.26.1 --filter @cue/server --filter @cue/mubit test
node apps/brief/test/smoke.mjs
```

Extension: `chrome://extensions` → Load unpacked → `apps/brief`. Full setup in `apps/brief/README.md`.

## Secrets (none are in git)

| What | Where |
|---|---|
| Mubit key, Trellus key | Modal secret `corgi-cue-keys`; local `.env` |
| Server API token | Modal secret `corgi-cue-token`; local `.env.modal`; the extension's `apps/brief/cue.config.js` |
| Exa and Gemini keys (brief only) | `apps/brief/config.js` |

All three local files are gitignored. A fresh clone needs them written by hand: copy the
`*.example.js` files.

## Costs

The Modal container is always on (`min_containers=1`, 0.5 core, 512 MB in eu-west): roughly
$20–35 a month. Stop it between demos with `modal app stop corgi-cue`. A redeploy starts it again,
and the database is kept on the `corgi-cue-data` volume.

## Known issues

- **Pre-existing Windows test failures:** 4 tests in `packages/ui` `no-raw-colour` fail on Windows
  paths, before this branch too.
- **Personal email in the repo:** `apps/brief/rules.json` sets the SEC User-Agent with a personal
  email (inherited from Corgi Brief; SEC requires a contact). Swap it for a team address if wanted.
- **The extension manifest test** in `apps/extension` (the older React extension, not used on this
  branch) needs a build first.
