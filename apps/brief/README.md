# Corgi Cue

Corgi Brief with the call in it. A Chrome side panel beside HubSpot and Trellus: when a Trellus
parallel dial connects, the brief fills in (filings, what they do, the biggest risk, the policies
that fit, an opener to read), **and while you talk, the line to say next appears at the top**,
written for exactly what the prospect just said and for this company, from the lines that have
booked meetings on the team's calls.

Trellus stays the dialer (it wraps Twilio). Cue wraps Trellus: it watches the dialer's card for the
connect, hears the call tab and your mic, and never touches the call itself.

```
Trellus card → connected            (content.js, inside Trellus's shadow DOM)
   ├─ the brief: EDGAR + Exa + Gemini (background.js, as Corgi Brief always did)
   │      └─ sent to the Cue server   (PUT /api/calls/:id/brief), so the live line knows it
   └─ the call: POST /api/calls on the Cue server (Modal, eu-west)
          offscreen.js: call tab audio (them) + mic (you) → Deepgram (EU) → every interim and final
          → POST /api/calls/:id/turns → live_cue through Mubit, streamed → SSE → live.js: SAY NEXT
Trellus card → ended → "How did it go?" → outcome + review → the playbook learns
```

## Setup

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder (`apps/brief`)
2. Click the extension icon once **on the HubSpot tab** to open the panel. It then stays open across
   pages, and that click is what lets Chrome hand Cue the tab's audio later (a Chrome rule).
3. **Move it to the left:** right-click the panel's border → *Move side panel to the left*. One-time.
4. Two gitignored files hold the keys:
   - `config.js`: Exa and Gemini keys for the brief (copy `config.example.js`, or Corgi Brief's own `config.js`).
   - `cue.config.js`: the Cue server URL and its token (copy `cue.config.example.js`). The token is the
     server's `CUE_API_TOKEN`; on Modal it is the `corgi-cue-token` secret, and `.env.modal` at the repo
     root keeps a copy.
   Storage always wins, so either can be changed from the service-worker console:
   ```js
   chrome.storage.local.set({ exaKey: 'NEW_KEY', cueServer: 'https://…', cueToken: '…' })
   ```
5. The first call asks for the microphone: press **Allow microphone** in the panel once.

**Shortcuts:** `Alt+Shift+C` briefs the record on screen. `Alt+Shift+L` on a tab hears the call from
that tab: use it if THEM shows ✗ (Chrome only lets an extension capture a tab the rep invoked it on,
or if the dialer's audio plays in another tab).

## The live section

```
● Live 1:14                                   THEM ✓  YOU ✓  CUE ✓
Say next                          "WHAT'S THIS REGARDING?" · COLD
┃ Honestly? Insurance. Worst cold-call topic there is. Give me thirty
┃ seconds on your E&O and I'll let you go.
Cold and clipped: the self-aware line wins here · 2.1× the straight answer with cold CEOs · 41 calls · 412 ms
Guarded, wants the point fast before deciding to hang up
If they say
 · "We already have a broker" Ask when they last re-quoted after the raise
 · "Fine, go on" One line on E&O for enterprise contracts
▸ Transcript
```

- **One line, set apart.** Everything else stays at the brief's one type size.
- **The read under it** (italic) is the model's own reading of what they meant, written before the line.
- **Evidence and speed:** where the line comes from in the playbook, and ms from the end of their
  sentence to the card.
- **After the call:** *How did it go?* (Booked, Follow-up, Callback, Not interested, Gatekeeper,
  Voicemail). The outcome goes to the server, the call is reviewed, and the panel says what the
  playbook learned: lines scored, and lines you improvised that booked joining the playbook.

## How the line gets better

1. **Every turn is one `live_cue` call through Mubit**, streamed: the read (meaning, moment, who,
   how warm) first, then the line. The card goes up as soon as the line is complete in the stream.
2. **The prompt carries the team playbook** with each line's record (used, won, booked), drawn per call
   by Thompson sampling, so proven lines are preferred and new ones still get tried.
3. **After the call**, the outcome and the transcript are reviewed: lines the rep actually said get
   their win or loss, and a line the rep improvised on a booked call joins the playbook as a young
   line (after the policy check), so the next calls try it.
4. **Mubit records every live_cue call** as one task and trains a small model on it: the same job,
   faster and cheaper, on the team's own calls.

## Test

`node apps/brief/test/smoke.mjs` loads the extension into Chromium against a local server (no keys,
no spend): a Trellus card in a shadow root flips to connected, a call starts, the panel follows it
over SSE, disconnect + *Booked* records the outcome, and a scripted card renders (screenshots in
`test-results/brief/`).

---

# The brief (Corgi Brief)

**Hotkey is `Alt+Shift+C`.** Not Ctrl+Shift+D — Chrome reserves that for "bookmark
all tabs" and an extension cannot override a reserved shortcut. Rebind anything
you like at `chrome://extensions/shortcuts`.

## If the hotkey does nothing

There is a **"Brief this page" button in the panel**. It does the same thing and
does not depend on Chrome binding a shortcut — use it to tell the two cases apart.

- **Button works, hotkey doesn't** → Chrome never registered the command. It leaves
  one silently unbound on conflict. Go to `chrome://extensions/shortcuts`, find
  Corgi Brief, and set it by hand. Commands register at *load*, so a manifest
  change needs a reload before a new key exists at all.
- **Neither works** → the panel now says why instead of failing silently. The usual
  cause was loading the extension while HubSpot was already open: content scripts
  only inject at page load, so that tab never had one, `sendMessage` rejected, and
  a `.catch(() => {})` ate it. It now injects on demand via `chrome.scripting`.

Every failure on that path — wrong tab, no content script, no company on the page,
no API key — now renders in the panel.

Result: brief on the left, HubSpot and the Trellus dialer on the right. The browser
reserves the space itself, so nothing fights HubSpot's fixed nav or Trellus's
absolutely-positioned sidebar.

## Hot reload (off by default)

With `DEV = true` at the bottom of `background.js`, the worker watches every extension file, and when one changes it reloads the
extension and refreshes your HubSpot tabs. Edit a file, wait ~1s, it's live —
including `manifest.json`, which normally forces a manual reload.

It works because unpacked extensions are served off disk, so the worker can fetch
its own files with `cache:'no-store'` and hash them. Reloading restarts the worker,
which re-reads the baseline — that's what stops it looping on the same edit. The
HubSpot refresh is behind a storage flag so a normal browser start never touches
your tabs.

It is off here (`DEV = false`) because it polls once a second forever; turn it on only while editing.

## What you actually read

Top to bottom, all one font size — labels only, no conversational framing:

```
fetched from sources: ✓Exa ✓SEC          <- 9.5px, the smallest thing on screen
COMPANY NAME              [Series A] [3/3]

FORM D — VERIFIED
Round still open — $1.3M of $9.9M left
Raised / Sold / Investors
Outside directors — the new D&O insureds

OPENER          <- the line you read
CONTEXT         <- the answer to "what is this regarding?"
URGENCY         <- deadline framing
WHY NOW         <- triggers
WHAT THEY DO
QUESTIONS
```

**Confidence is `n/3`, and it scores sourcing, not persuasiveness.** Hover it for
the breakdown. The three checks:

1. **SEC entity verified** — EDGAR matched this exact company, not a similarly
   named SPV. This is what makes a number safe to say out loud.
2. **Form D on file** — there is a filing behind the round figures.
3. **Sourced opener** — Exa returned a hook tied to a real fact.

`3/3` you can read cold. `0/3` means the opener is generic and the panel says so.
Form D sits above the opener because a verified dollar figure is the only thing
on screen that is a fact rather than a synthesis.

Prospect names are not shown — they are on the HubSpot record next to you.

## Latency, measured

| leg | lands at | note |
|---|---|---|
| EDGAR | ~0ms | prewarmed while the number rings — SEC is free |
| the line you read | ~1.6-2.0s | its own small Exa call |
| the arsenal | ~2.1-2.6s | second Exa call, arrives while you are still talking |

Three things buy that:

- **Two Exa calls, not one.** Measured: script-only schema ~1.6s, the full 7-field
  schema ~2.9s. The arrays cost the difference, so they got their own call.
- **EDGAR prewarms on `ringing`.** SEC is free and unmetered, so every ringing
  number gets its filing fetched before anyone answers. Zero cost, takes a whole
  leg off the critical path.
- **DNS/TLS warmed** when the panel opens, not when someone says hello.

What does *not* help, measured: `instant` vs `fast` (~1.4s either way) and
`numResults` 8 vs 3 (inside the noise). Synthesis is the floor.

**Cost note:** two calls is $0.014 per connect, so ~$15/mo at 50/day — about $5
past the free credits. Collapse back to one call if that matters more than the
1.3s.

## When it fires

**Only on connect.** Opening a contact does nothing.

Trellus marks the answered prospect's card `data-status="connected"` — that's the
dialer's own state, so the extension watches for it rather than scraping a
counter. `Alt+Shift+C` re-runs by hand against the open HubSpot record.

**The gotcha that breaks naive versions:** Trellus renders inside
`<template shadowrootmode="open">`. `document.body.innerText` and a plain
`querySelector` **cannot see into shadow DOM** — detection silently never fires.
`deepQueryAll()` walks every open `shadowRoot` to find the card.

## Which company it researches

The connected card carries everything, so HubSpot never has to be read:

```
.name-text          -> Sirish Bindal
.title              -> "Partner & CX Practice Head - Infovity"   (company after last " - ")
.custom-tag__value  -> sbindal@infovity.com                      (domain after "@")
```

Domain beats name — "Casap" misses where `casaphq.com` resolves — and taking it
off the *connected card* removes any ambiguity about which of the five answered.
Free-mail domains fall back to the company name. The `Alt+Shift+C` path uses
HubSpot's stable test-ids (`company-chicklet-domain`, `company-chicklet-title-link`),
never its class names, which churn.

## What it pulls

Two lookups fired together, ~2.2–2.4s — inside the ~5s your opener buys.

| source | gives you | cost |
|---|---|---|
| Exa `fast` + `outputSchema` | the opener, what they do, stage, 3 "why now" triggers | ~$0.008/call |
| SEC EDGAR Form D | exact round size, how much is still open, investors, **the board** | free |

At ~50 connects/day that's **$8.80/mo — inside Exa's $10/mo free credits.**

Real output:

```
OPENER  > Saw you are scaling GRC to support enterprise clients - that is usually
          right when they start asking for heavy E&O indemnities in your contracts.
why now : Managing SOC 2 and ISO 27001 audits
          Rapidly scaling global headcount across regions
          Negotiating high-stakes SaaS agreements with Fortune 500 customers
SEC     : Round still open — $3.5M of $65.0M left  [verified]
board   : Jesse Zhang | Ashwin Sreenivas | Ivan Zhou | Aaref Hilaly
```

The coverage is matched to the trigger, not stamped on — enterprise contracts
produce an E&O opener, a fresh priced round produces a D&O one.

**Stage is a guess; the dollar amount is a fact.** Form D never states a stage —
it reports dollars only. "Series D" comes from Exa reading press. The card keeps
them in separate blocks so you know which one is safe to say out loud.

## Two things that will bite you if you rewrite this

**1. `www.sec.gov/Archives/*` 403s a normal browser User-Agent.** It wants contact
info in the UA, and `User-Agent` is a *forbidden header* in `fetch()` — JS can't set
it. `rules.json` rewrites it via `declarativeNetRequest`. Delete that file and
`data.sec.gov` keeps returning clean 200s while the endpoint holding the money
silently 403s. Put your own email in it.

**2. Brand name ≠ legal entity.** Taking EDGAR's top hit was wrong 4 times in 6:
Ramp→On-Ramp Wireless, Decagon→DAM (US) Fund LP, Anysphere→a Hiive SPV holding
Cursor stock. So it scores candidates and **refuses below threshold** rather than
guessing. Measured now:

```
Loamy Technologies   sure   Round still open — $1.3M of $9.9M left
Decagon              sure   Round still open — $3.5M of $65.0M left
Kalshi               sure   Round still open — $380.0M of $1.50B left
Ramp                 maybe  Round still open — $86.3M of $868.3M left
Rippling             MISS   closest was Rage Labs Inc.
Anysphere            MISS   closest was HII Anysphere-01 SPV
```

**maybe** is why the card says *"say you saw they filed recently, not the number."*
Reading a stranger's round back to a founder is worse than saying nothing.
Rippling is unreachable by name — it files as *People Center, Inc.*

## Tuning

- **Wrong company picked up?** `findName()` in `content.js` grabs the first domain on
  the page that isn't HubSpot/Google/LinkedIn. Add exclusions there.
- **Card too slow?** Exa `type` → `instant` (measured 586ms cold vs `fast` 932ms), but
  drop `outputSchema` too — the synthesis is what costs the ~1.5s.
- **Want tighter copy?** Edit the `description` fields in the `outputSchema`. That's
  the whole prompt.

## Notes

- Form D covers Reg D raises only. Other exemptions and most foreign entities never appear.
- It's filed up to 15 days *after* first sale — but "still open" stays true regardless,
  and that's the line worth saying.
- `numSentences` / `highlightsPerUrl` are deprecated in Exa; use `highlights: true`.
