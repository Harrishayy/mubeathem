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
| Streaming Mubit client | `packages/mubit/src/client.ts`, `stream.ts` | Works (Responses API), plus `embed()` over `/embeddings` |
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

## Measured (`docs/perf/live-latency-2026-10-24-modal-speculate.json`)

Real calls replayed in real time against Modal, measured on the rep's side of the wire (end of the
prospect's speech → first card on SSE; 0 = the card was up before they finished):

| | Start of day | Now |
|---|---|---|
| Median | 1491 ms | **0 ms** |
| p95 | 1725 ms | 1381 ms |
| Cards under 600 ms | 29% | **90%** |
| Moment accuracy vs the script labels | 71% | 74% |
| Network round trip | ~105 ms | ~118 ms |

What got it there, in order of effect:
1. **Speculative runs** (`CUE_SPECULATE_WORDS=4`): `live_cue` starts on the prospect's interim once it has
   4 words, and newer words run after it (never cutting it short). The first card is often from part of
   the sentence; the run on the full sentence refines it in place.
2. **The line streams first** (`say` before the read in `LiveCueOutput`, `live_cue` v4): the card no
   longer waits ~40 tokens of read.
3. **Predicted replies** (`CUE_PREDICT=3`, match 0.5): 3 of 20 cards in the last run.
4. Endpoint pause 150 ms (`CUE_ENDPOINT_PAUSE_MS`).

What's left over 1 s: one-word replies ("Yeah.", "No."), below the 4-word speculation threshold and too
short to match a prediction. Cost: speculation and predictions add model calls (roughly 2–4 extra
`live_cue` calls per prospect turn, all on `gpt-4.1-mini`).

**Why a call after the prospect stops can't be under 600 ms.** Through Mubit, even a one-sentence prompt takes ~520 ms to the first
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

1. **Under 1 s.** *Done on Modal: median 0 ms, 90% under 600 ms (see Measured).* Left: one-word replies
   (~1.4 s). Ideas: speculate from 1 word when the interim ends in punctuation, or a pre-written line
   for "yes"/"no" after each card. Tune cost with `CUE_SPECULATE_WORDS` and `CUE_PREDICT`.
2. **Deepgram.** *Done.* The key in `.env` can transcribe but not mint browser tokens (403), so the server
   relays the audio: `/api/stt/token` hands out a short-lived Cue token and `wss://{server}/v1/listen` pipes
   to Deepgram EU with the key (`apps/server/src/stt.ts` `SttRelay`, `CUE_STT_RELAY`). Verified through Modal.
   Keys reach Modal with `deploy/modal/setup-secrets.sh` (a container restart picks up new secrets).
3. **Remove Gemini from the brief.** *Done.* `synthBrief()` posts to `POST /api/brief/synth` (Mubit task
   `synth_brief`, same SYNTH + POLICY_BLURB prompt). The Gemini stream path and `CUE_LIVE_PROVIDER` are
   gone from `@cue/mubit`; live_cue defaults to `gpt-4.1-mini`.
4. **Check where Trellus plays the call audio.** Cue captures the tab where the connected card appeared.
   - If Trellus plays audio elsewhere, the panel shows THEM ✗; press Alt+Shift+L on the tab that plays it.
   - Not yet tested on a real Trellus call.
5. **Moment accuracy (74% now; not a priority, demo cases are cherry-picked).** Mostly gatekeeper vs opener on transfers. *Transfer rules and three reads added to
   the `live_cue` instructions, `version: 2` (a new Mubit task).* Re-measure with `latency:live`.
6. **Trellus outcomes.** *Checked 2026-10-24 with the real key:* reachable, `POST /api/trellus/sync` imported
   15 Trellus calls (0 matched, as the scratch database had no Cue calls). Dispositions in the account:
   NO_ANSWER, LEFT_VOICEMAIL, WRONG_NUMBER, GATEKEEPER map by default; OTHER_ANSWERED is unmapped (counts as
   `unknown`, set an override in Settings if it should mean something).

## How to run

```bash
npx pnpm@10.26.1 i
# local server: .env needs MUBIT_API_KEY (gitignored); CUE_PIPELINE=live for the new path
CUE_PIPELINE=live npx pnpm@10.26.1 --filter @cue/server dev
# keys from .env → Modal secrets, new server token, local configs, deploy (uses .env's MODAL_TOKEN_*)
deploy/modal/setup-secrets.sh
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
| Exa key (brief only) | `apps/brief/config.js` |

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
