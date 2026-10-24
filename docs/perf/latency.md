# Turn-to-card latency

Goal: the rep sees a usable card **300–500 ms after the prospect stops talking** (p50 ≤ 350 ms,
p95 ≤ 500 ms, server side, end of speech → `suggestion.shown`). Before this work a card took
p50 2.3 s / p95 3.5 s, because it waited on Mubit `read_moment` (~1.65 s) and `write_line` (~1.45 s).

**Result (2026-10-24), shipped defaults, Deepgram-style transcripts:**

| | ready p50 | ready p95 | card changes after end of speech | changes while the rep spoke | cards Mubit-written | spend / turn |
|---|---|---|---|---|---|---|
| before (Mubit) | 2317 ms | 3460 ms | 0% | 0 | 27/28 | $0.0019 |
| **after, with Mubit** | **0 ms** | **204 ms** | 3% | 0 | 18/32 | $0.0035 |
| **after, rules only** | **0 ms** | **203 ms** | 3% | 0 | – | $0 |
| after, rules only, Web Speech transcripts | 0 ms | 457 ms | 6% | 0 | – | $0 |

"Ready" = ms from the end of speech to the first card, counted as 0 when the card was already up
before the prospect finished (a card ready early costs the rep nothing). Raw values are in the JSON.
The 200 ms floor is the transcriber's lag (`--stt-lag`): the server cannot know a word before the
transcriber sends it.

## The harness

`pnpm --filter @cue/server latency:sim` (`apps/server/src/scripts/latency-sim.ts`, scripts in
`latency-scripts.ts`) boots the real server in process on a temp db and replays six cold calls in
real time: the demo script (gatekeeper, broker, buying signal, compliance slip, close) plus a
gatekeeper wall, brush-offs with one-word answers ("Yeah.", "No."), an objection run with 30–50 word
rambles, a fast buying signal with interruptions (negative gaps), and a call with two compliance
slips. 37 prospect turns, 32 with an expected card.

Speech model: 2.6 words/s; an interim every 250 ms carrying the words spoken up to 200 ms ago; the
final at end of speech + 450 ms (Deepgram `endpointing=300`; `--final-delay=900 --no-punct` models
Web Speech: later finals, unpunctuated interims). The rep starts replying 900 ms after the prospect
stops. Per prospect turn it records: end of speech → first card, → last version; first card from
the final; whether the card's words changed after it was first shown (flicker), and whether that
happened after the end of speech; first vs final moment; moment accuracy against the script's label;
whether the card changed after the rep started talking. It writes `docs/perf/latency-<date>-<label>.json`.

Flags: `--mubit` (real Mubit, cheap models forced, `--cap` USD for the run), `--fake-mubit` (a
stand-in with the measured latency distribution: free, for tuning the flow), `--scripts=`,
`--parallel`, `--set KEY=VALUE` (any server env var), `--final-delay`, `--stt-lag`, `--interim-ms`,
`--wps`, `--rep-react`, `--no-punct`.

## Strategy log

Columns: ready p50/p95 (ms from end of speech), first card from the final (negative = before it),
final-version p95, flicker (after end of speech), first moment = final moment, accuracy of the first
/ final card's moment against the labels, cards changed after the rep started talking, cards whose
words Mubit wrote (refined or standby), `read_moment` and `write_line` calls / of which aborted,
spend for the run.

| run | ready p50 | ready p95 | from final p50 | from final p95 | final p95 | flicker (after end) | first = final | accuracy | changed under rep | Mubit-written | reads | writes | spend |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline-rules ¹ | 454 | 458 | 4 | 8 | 458 | 0% (0%) | 100% | 61% / 61% | 0 | 0/25 | – | – | – |
| baseline-mubit | 2317 | 3460 | 1867 | 3010 | 3460 | 0% (0%) | 100% | 74% / 74% | 0 | 27/28 | 30/0 | 34/1 | $0.0606 ² |
| rules read tuned, final only | 453 | 460 | 3 | 10 | 460 | 0% (0%) | 100% | 81% / 81% | 0 | – | – | – | – |
| + endpointing, pause 500 | 201 | 213 | -249 | -237 | 213 | 0% (0%) | 100% | 86% / 86% | 0 | – | – | – | – |
| + endpointing, pause 350 | 0 | 205 | -1307 | -245 | 205 | 6% (3%) | 94% | 81% / 86% | 0 | – | – | – | – |
| + endpointing, pause 250 (shipped) | 0 | 203 | -1389 | -247 | 203 | 6% (3%) | 94% | 81% / 86% | 0 | – | – | – | – |
| Web Speech, pause 500 | 703 | 903 | -197 | 3 | 903 | 0% (0%) | 100% | 81% / 81% | 0 | – | – | – | – |
| Web Speech, pause 350 | 0 | 556 | -1488 | -344 | 556 | 6% (3%) | 94% | 81% / 86% | 0 | – | – | – | – |
| Web Speech, pause 250 (shipped) | 0 | 457 | -1817 | -443 | 457 | 9% (6%) | 91% | 78% / 86% | 0 | – | – | – | – |
| fake: instant + early Mubit (restart per interim) + standby 2 | 0 | 205 | -1310 | -245 | 1569 | 16% (9%) | 94% | 81% / 86% | 1 | 16/32 | 159/110 | 140/58 | – |
| fake: early Mubit off | 0 | 204 | -1305 | -246 | 208 | 9% (6%) | 94% | 81% / 86% | 0 | 13/32 | 37/0 | 77/6 | – |
| fake: + recycle late drafts, standby 1 | 0 | 204 | -1309 | -246 | 1568 | 13% (9%) | 94% | 81% / 86% | 1 | 9/32 | 37/1 | 38/2 | – |
| fake: + recycle late drafts, standby 2 | 0 | 208 | -1308 | -242 | 211 | 9% (6%) | 94% | 81% / 86% | 0 | 13/32 | 37/1 | 57/1 | – |
| fake: + coalesced early Mubit, refine window from final, standby 1 | 0 | 209 | -1308 | -241 | 805 | 38% (19%) | 94% | 81% / 86% | 1 | 18/32 | 61/14 | 65/10 | – |
| fake: same, standby 2 | 0 | 209 | -1309 | -241 | 213 | 22% (9%) | 94% | 81% / 86% | 0 | 18/32 | 61/14 | 80/12 | – |
| **Mubit: shipped (standby 2, pause 350 ³)** | **0** | **204** | -1327 | -246 | 205 | 19% (3%) | 88% | 78% / 81% | **0** | 18/32 | 61/15 | 91/11 | $0.1293 |
| Mubit: standby 1 (demo + objections, cut by the cap) | 0 | 206 | -2320 | -244 | 228 | 45% (18%) | 82% | 57% / 71% | 0 | 7/11 | 22/7 | 25/4 | $0.0366 |

¹ Before the rules-read tuning and one label fix. ² Stopped at its cap before the last script.
³ The pause default moved to 250 after this run; with Deepgram-style punctuated interims 250 and 350
measure the same (203 vs 205 ms rules-only), so the Mubit run was not repeated. Fake-Mubit accuracy is the
rules engine's (its read *is* the rules read), so only its latency, flicker and call counts mean anything.

What each step taught:

1. **Instant card** (rules read + bandit line before any model call): from the final, 3–10 ms in
   process. That alone moves the card from 2.3 s to the transcriber's final delay (~450 ms).
2. **Rules read tuning** (`signals/rules.ts`: price complaints, "email it over", coverage questions,
   "we've been talking about that", "X could work"): first-card accuracy 61% → 81% on the labelled
   turns (Mubit's read: 74–81%). The instant card is what the rep sees first, so this matters as much as
   latency.
3. **Endpointing on interims** beats the final: p50 0 ms, p95 ~205 ms with punctuated interims. A
   shorter pause triggers more often mid-sentence ("Hi, this is…" → gatekeeper, then opener), which
   shows as flicker *before or right after* the end of speech, never under the rep.
4. **Early Mubit, restarted on every changed interim** wasted 110 of 159 reads (each billed and kept by
   Mubit as an aborted example). **Coalescing** (one run per utterance, restarted only when the rules
   moment changes; the final adopts it when its text or moment matches) cut it to 61 reads / 15
   aborted while still letting long turns get a Mubit-tailored card before the prospect finishes.
5. **Refinement** lands ~1.5–2 s after it starts. Measured from the card's first show it mostly
   arrived under the rep; the window now counts from the final (500 ms) and the rep's first interim
   locks the card, so 0 cards changed while the rep spoke in every Mubit run.
6. **Recycling** a draft that arrived too late into the standby cache, and **standby** pre-writes for
   the current and predicted moments, make 10–12 of 32 instant cards Mubit-written (`servedBy: 'cache'`)
   at 0 ms. Standby 2 vs 1: same Mubit-written share, fewer post-end changes (3% vs 18%), similar real
   spend on the demo script ($0.0276 vs $0.0279), so 2 is the default.
7. **Connection warm-up** on the first prospect interim: `read_moment` averaged 1676 ms vs 1649 ms
   before, so no measurable gain (model time dominates). It is free (`GET /models`) and stays on.

Not tried, and why: streaming `write_line` (the Mubit client has no streaming path and it would cost
live budget to validate; the say field comes first, so it could cut ~40% of a write); trimming
`read_moment` input (output tokens dominate its latency, and it would change what Mubit trains on);
skipping `read_moment` when the rules read is confident (it is the training record for every turn).

## What ships

Behind flags, all on by default (`.env.example`, architecture.md §5.3):

| Env | Default | |
|---|---|---|
| `CUE_INSTANT_CARD` | 1 | instant rules/standby card, Mubit refines in place (same suggestion id) |
| `CUE_EARLY_TRIGGER` | 1 | endpointing on interim prospect turns |
| `CUE_EARLY_MUBIT` | 1 | Mubit read/write start on the early trigger (coalesced) |
| `CUE_ENDPOINT_PAUSE_MS` | 250 | unchanged-interim silence that ends an unpunctuated sentence |
| `CUE_REFINE_WINDOW_MS` | 500 | refined card may replace the instant one until this long after the final |
| `CUE_STANDBY` | 2 | moments Mubit pre-writes lines for while the rep talks (0–3) |
| `CUE_WARM_MUBIT` | 1 | warm the Mubit connection when the prospect starts talking |

Contract (additive, `Suggestion`): `stage?: 'instant' | 'refined'`, `refinedAt?`, `refinedLatencyMs?`,
`precomputed?: 'standby'`. `latencyMs` is always the first version's.

## Costs and caveats

- **Spend**: ~$0.0035 per prospect turn with Mubit vs $0.0019 before (+80%): standby writes, the
  speculative write, and restarts when the moment changes mid-sentence (15 of 61 reads, 11 of 91
  writes were cancelled after being sent; they are billed and traced as `aborted`). `CUE_STANDBY=0` and
  `CUE_EARLY_MUBIT=0` are the levers (fake run: 37 reads / 77 writes with early Mubit off).
- Standby writes are `write_line` examples whose `lastProspectTurn` is a *predicted* reply. Same task and
  instructions, so they don't split it, but they are in Mubit's training data.
- The rep is only "heard" when their first interim arrives (~300–750 ms after they start). A swap can
  still land in that gap if Mubit answers within 500 ms of the final; none did in these runs. Clients
  with their own VAD should lock the card themselves (below).
- Interims only start the turn when the client sends them with a stable `id` (the web transcriber and
  the extension keep one id per utterance). The extension throttles interims to one per 700 ms (`interimGate`), which delays
  endpointing on unpunctuated text; Deepgram's punctuated interims are not affected much.
- Measured server side and in process; SSE delivery adds a write per event, not measured here.
- One run per configuration (37 turns). Mubit latency varies run to run; the instant layer doesn't
  depend on it.

## UI notes (for the web and extension owners; not changed here)

- A `suggestion.shown` whose id is already on screen is the same card refined: update the text in
  place (cross-fade the words, no enter animation, keep the card's position), keep any open action.
- `stage: 'instant'` with `view.pending === true` → an optional, quiet "refining" hint; `stage:
  'refined'` or `pending === false` → settled. `servedBy: 'cache'` + `precomputed: 'standby'` reads as
  "Mubit, written ahead" in the debug drawer.
- Lock the card (ignore same-id updates) as soon as the rep's mic VAD fires, or once the rep acts.
- Send prospect interims with the utterance's stable id, ideally every ~250 ms.
