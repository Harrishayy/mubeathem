# Cue

## Know exactly what to say next on every cold call.

**Cue is a Chrome extension that sits beside Trellus and reads your call as it happens. Every time the prospect speaks, it shows you the one line most likely to get you to a booked meeting, learned from every call your team has ever made.**

| | |
| --- | --- |
| **What it is** | A live suggestion panel for cold calls. It listens to the transcript, recognises the moment you're in (gatekeeper, cold "what's this regarding?", "we already have a broker"…) and surfaces the line that has booked the most meetings in that exact spot. |
| **Who it's for** | **BDRs and SDRs** making high-volume cold calls, especially **new reps** who don't yet know the track, and the **sales managers** who have to teach it. |
| **Why it exists** | A BDR has one job: **book the meeting**. The best reps already know what to say at every turn. Everyone else learns it slowly, call by call. Cue turns the whole team's calls into a live playbook, so a rep in their first week sounds like a rep in their first year. |

Built with **Mubit** (model gateway + adapter training), **Banyan Sapling** (policy checks) and **Exa** (prospect research). Runs on top of **Trellus**.

---

## 1. The problem

We're BDRs at [Corgi](https://www.corgi.insure), an AI-native insurance carrier for startups. Our day is dials, and our scoreboard is meetings booked.

**Cold calling is a track.** One human follows a sequence of responses to another human. Opener → "what's this regarding?" → the brush-off → the objection → the ask. At each step there's a line that works better than the others. The best reps have learned those lines, and the rest of the team hasn't.

**Teaching the track is slow.** New reps get a script, then shadow calls, then get thrown on the phones. The question they always ask is *"OK, but when am I meant to say this?"* A script can't answer that. Only live calls can, and every bad call while they learn is a meeting the team didn't book.

**Nobody knows which lines actually book meetings.** A team making thousands of dials a week is running a huge experiment, but no one records which response, in which situation, got the meeting. The knowledge lives in a few people's heads and leaves when they do.

**The same question needs different answers.** A friendly "oh, what's this regarding?" and an irritated "…what's this regarding?" are different moments. One wants a straight answer. The other might want a self-aware joke. Which one works is something the data should decide, not a script.

## 2. What Cue is (and isn't)

**Cue is:**

- A **side panel** in Chrome that docks next to Trellus
- **Transcript-driven:** it reads what's being said, live, and nothing else is needed
- **One suggestion at a time:** the line to say now, with a short reason and how often it has worked
- **Learning:** every booked (or lost) meeting improves the next suggestion for the whole team

**Cue isn't:**

- A dialer. Trellus still places the calls, runs the parallel lines and logs to the CRM.
- A script. Nothing is shown unless the moment calls for it.
- An auto-pilot. The rep is always the one talking. Cue whispers; it never speaks.

## 3. Who it's for

| | What they get |
| --- | --- |
| **New BDRs** | The track, live. They see *what* to say and *when* to say it on real calls, so ramp time drops from months to weeks. |
| **Experienced BDRs** | Only the high-value moments: a better gatekeeper line, a sharper objection handle, a research hook they didn't have time to find. |
| **Sales managers** | A playbook that writes itself: which lines book meetings, for which personas, and which new lines are starting to win. |
| **RevOps / compliance** | Every suggestion checked against sales policy before a rep ever sees it. |

---

## 4. The experience

Cue should feel like a calm, beautiful co-pilot, not another dashboard. One glance, one line, back to the conversation.

### 4.1 The panel

```
╭──────────────────────────────────────────────╮
│  ●  LIVE  02:14                    ⚙   ─     │
│                                              │
│  Maya Chen                                   │
│  CEO · Lumen Labs · Series A (Mar)           │
│  ┌────────┐ ┌──────────────┐                 │
│  │  CEO   │ │ ▂▃▅ cooling  │                 │
│  └────────┘ └──────────────┘                 │
│──────────────────────────────────────────────│
│                                              │
│  🧊  COLD "WHAT'S THIS REGARDING?"           │
│                                              │
│  "Honestly? Insurance. Worst cold-call       │
│   topic there is. Give me thirty seconds     │
│   and I'll let you go."                      │
│                                              │
│  Books 2.1× more than the straight answer    │
│  with cold CEOs · 41 calls                   │
│                                              │
│──────────────────────────────────────────────│
│  UP NEXT, IF THEY SAY…                       │
│  "We have a broker"   → ask about re-quote   │
│  "Send me an email"   → ask for 15 min       │
│──────────────────────────────────────────────│
│  ▸ Brief   ▸ Transcript   ▸ Flags (0)        │
╰──────────────────────────────────────────────╯
```

- **Header:** who you're talking to (from HubSpot, confirmed by the transcript), their persona chip, and a small **receptivity** indicator that drifts warm ↔ cold as the call goes.
- **The card:** the hero of the panel. The moment's name, one line in large type, and one line of evidence. Nothing else.
- **Up next:** the two most likely things the prospect says next, with the move for each, so the rep is never caught flat-footed.
- **Drawers:** the pre-call brief, the live transcript and compliance flags, collapsed until you want them.

### 4.2 Design principles

- **One thing at a time.** Never more than one suggestion on screen. A new card replaces the old one with a soft cross-fade (~150 ms).
- **Readable at a glance.** The line is set large (20–22 px), high contrast, short enough to read in one second. If a line can't be said in one breath, it's too long.
- **Colour means the moment.** Each moment type has its own accent: gatekeeper (slate), opener (blue), cold/brush-off (ice), objection (violet), buying signal (green), close (gold), compliance (amber). After a week reps recognise the moment before they read it.
- **Evidence, always.** Every line says why it's there: "booked 11 of 34 times here". Reps trust what they can see working.
- **Quiet when it should be.** No card while the rep is mid-sentence, and nothing during small talk that's going well. Suggestions arrive within ~1.5 s of the prospect finishing a turn.
- **Light and dark.** Follows the system theme, and looks good next to Trellus in both.
- **Respectful motion.** No bouncing, no flashing, nothing that pulls the eye mid-sentence. Compliance flags are the only thing that pulses, once.

### 4.3 Card types

> 🚪 **Gatekeeper**
> *"Totally fair. It's about the board's D&O cover after the raise. Is that usually Maya, or does your CFO handle it?"*
> Transferred or got a name 14 of 38 times.

> 👋 **Opener (CEO, recently raised)**
> *"Maya, it's Alex at Corgi. Saw the Series A, congrats. Quick one: has anyone talked to you about D&O since the board changed?"*

> 🧊 **Cold "what's this regarding?"**
> *"Honestly? Insurance. Worst cold-call topic there is. Thirty seconds and I'll let you go."*

> 🛡️ **Objection: "we already have a broker"**
> *"Makes sense, most founders do. When did they last re-quote you after a raise?"*

> 📩 **Brush-off: "just send me an email"**
> *"Happy to. So it's actually useful, what's the one thing you'd want it to answer?"*

> 🟢 **Buying signal**
> They asked about price. Go for the meeting: *"Easiest is fifteen minutes with our team, they'll quote you live. Thursday or Friday?"*

> ⚠️ **Compliance**
> "That would definitely be covered" can't be promised before underwriting. Try: *"That's exactly what the quote call will confirm."*

---

## 5. How Cue reads the moment

Everything starts from the **transcript**. Cue captures the call audio in the browser, transcribes it live with speaker labels, and works out three things after every prospect turn:

### 5.1 Who you're talking to

The **HubSpot title** is the starting assumption. The **transcript** confirms or overrides it:

- HubSpot says CEO and nothing contradicts it → **CEO track**
- "She's in a meeting, can I take a message?" → **Gatekeeper**, whatever the record says
- A second voice joins and asks about cost → **CEO + CFO track**
- "I'm one of the engineers here" → **Engineer track** (different pains: AI liability and E&O, not board D&O)

### 5.2 How receptive they are

A simple **warm / neutral / cool / cold** reading from the transcript itself:

- **Words:** "oh sure, what's up" vs "who gave you this number?"
- **Shape:** one-word answers, cutting the rep off, long silences before replying, or asking questions back
- **Trend:** whether their share of the conversation is growing or shrinking

Receptivity is part of the moment. The playbook learns separately what works on a warm CEO and on a cold one. If a jokey line beats the straight answer when the prospect is cold, Cue will find that out and start suggesting it.

### 5.3 What just happened

The **moment**: opener, gatekeeper, "what's this regarding?", brush-off, objection (and which one), buying signal, ready to close.

**Who + receptivity + moment** = the **situation**. Every suggestion, and everything Cue learns, is keyed on the situation.

### 5.4 The flow

```
 Trellus call (in the HubSpot tab)               HubSpot contact
         │ tab audio + rep mic                         │ name, title, company
         ▼                                             ▼
 Live transcript (speaker-labelled)            Exa research (at dial time)
         │                                             │ raise, hiring, product, news
         ▼                                             │
 ┌─ Read the moment (via Mubit) ──────────┐            │
 │ who · receptivity · moment             │            │
 └──────────────────┬─────────────────────┘            │
                    ▼                                  │
     Playbook: best lines for this situation           │
     (ranked by meetings booked, team-wide)            │
                    ▼                                  ▼
          Write the line (via Mubit) ◄──────── hooks for this prospect
                    ▼
          Sapling policy check
                    ▼
            ✨ Card in the panel
```

---

## 6. Learning what books meetings

### 6.1 One metric

**A BDR's job is to book the meeting.** That's what Cue optimises for.

Later outcomes (did the meeting happen, did the company buy a policy) are real, but they depend on the AE, the quote, the timing and a dozen other things. They can't be fairly traced back to one line on one cold call. Cue reports them, but doesn't rank lines on them.

### 6.2 Every step has a job

Not every line can book a meeting by itself. The opener's job is to earn the next thirty seconds. So each moment is scored on what it's for, with the booked meeting as the final word:

| Moment | Its job | Counted as a win when… |
| --- | --- | --- |
| Gatekeeper | Get through | Transferred, or got the decision-maker's name / best time |
| Opener | Earn time | The prospect is still talking 30 s later |
| "What's this regarding?" | Earn time | The prospect asks a follow-up instead of ending the call |
| Brush-off / objection | Keep it alive | The call continues past the next two turns |
| Close | **Book it** | Meeting booked |
| *Every line* | — | **Also credited if the call ends in a booked meeting** |

### 6.3 The playbook

- Every suggestion has a `line_id`. After the call, Cue checks the transcript to see **whether the rep actually said it** (or something close).
- Each line keeps simple stats **per situation**: times shown, times used, step wins, meetings booked.
- Lines are ranked with a bandit (Thompson sampling): proven winners are shown most often, new lines still get a fair trial, and lines that stop working fade out.
- **Outcome comes from Trellus and HubSpot:** the call disposition, or a meeting created on the contact. The rep can also tap **Booked** in the panel.
- **New lines come from the reps.** When a rep goes off-script and the call books, Cue pulls out what they said as a **candidate line**. It's policy-checked, then a manager approves it before it joins the playbook.

The playbook updates after every call. No retraining is needed for Cue to start preferring a line that's winning.

---

## 7. How Mubit is used

[Mubit](https://docs.mubit.ai) sits between Cue and the model provider. Every model call goes through it with a one-line change:

```python
from openai import OpenAI
client = OpenAI(
    base_url="https://api.mubit.ai/openai/v1",
    api_key=os.environ["MUBIT_API_KEY"],
)
```

Mubit records every call, groups calls with the same instructions and output format into **tasks**, and once a task has enough examples (25 by default) trains an **adapter**: a small model built for that one job, tested against the frontier model's answers.

Cue is deliberately built from a few fixed, high-volume tasks, which is exactly what Mubit learns well:

| Task | In | Out | Runs |
| --- | --- | --- | --- |
| `read_moment` | last ~30 s of transcript + HubSpot title | `{who, receptivity, moment}` | after every prospect turn |
| `write_line` | situation + top playbook lines + Exa hooks | `{say, why, line_id}` | at every decision moment |
| `research_brief` | Exa results | 3 hooks for this prospect | when the call starts |
| `review_call` | full transcript + outcome | lines used, candidate new lines | after the call |

- Every request carries `metadata.session_id = <call id>`, so each phone call shows up in Mubit as one session.
- Anything prospect-specific goes in the **user message**, never the instructions, so every call of a task lands in the same Mubit task.

### Why this is the right split

- **The playbook decides what wins.** It learns from meetings booked and updates after every call.
- **Mubit makes it fast and cheap.** `write_line` always gets the current best lines and tailors one to this prospect and this moment. Mubit distils that into a small model trained on our own calls. That's what lets Cue run on every dial for every rep, within the ~1.5 s window where a suggestion is still useful.

As the playbook improves, the adapter gets better inputs. As the adapter improves, suggestions get faster and cheaper. Over time, the opener, the gatekeeper line and the answer to any curveball all converge on what books meetings for this team.

---

## 8. How Banyan Sapling is used

[Banyan Sapling](https://huggingface.co/MubitLabs/banyan-sapling) checks a **claim** against a **policy** and **evidence**, and returns `supported`, `violation`, `insufficient_information` or `inconsistent_context`. Its calibrated `status` can also be `unsure`. Insurance is regulated, so Cue never wants to coach a rep into saying something they can't.

1. **Every suggestion, before it's shown.** If a line would break policy, it's never displayed.
2. **What the rep says.** Claims about coverage, price or terms are checked live. Example policy (illustrative): *"Never promise a specific claim will be covered. Never quote a premium before a quote is generated."* A violation shows an amber card with a safe rephrase.
3. **New candidate lines.** Optimising for meetings will surface shortcuts: if overpromising books meetings, the data will say "overpromise". Every new line passes Sapling before it can join the playbook. Cue learns to win **inside the rules**.

`unsure` results are never shown live. They go to a manager review list after the call.

## 9. How Exa is used

When the dial starts, Cue runs a few [Exa](https://exa.ai) searches on the prospect and their company (`category: "company"` / `"people"`, `highlights: true`) and turns what it finds into hooks for the opener:

| Exa finds… | Hook for a Corgi call |
| --- | --- |
| A recent raise | The board and new investors will expect D&O |
| An AI product | AI liability |
| Lots of open roles | EPLI as the team grows |
| Enterprise customers | E&O and cyber that contracts require |
| A new office or market | Coverage where they now operate |

Research runs at dial time, never on the live suggestion path. If the prospect mentions something new mid-call ("we just launched in Europe"), a fast `lite` search (~450 ms) can refresh the hooks in the background.

## 10. Working with Trellus

Trellus stays exactly as it is: the dialer, the parallel lines, the voicemail drops and the CRM logging. Cue sits beside it:

- **Side panel** docked next to the Trellus / HubSpot tab
- **Audio** captured in the browser: the prospect from the calling tab, the rep from the mic
- **Context** from the HubSpot contact Trellus is dialling
- **Outcome** from the Trellus disposition or the HubSpot meeting, with a **Booked** button in the panel as a fallback

No changes to how reps already work. Install the extension, and the next call has Cue on it.

---

## 11. The demo

A teammate plays the prospect. The screen recording shows Trellus and Cue side by side.

1. **Setup:** a HubSpot contact for a real, recently funded startup, title **CEO**. Cue shows the Exa brief: the raise, the AI product, the hiring.
2. **Dial.** The teammate answers as an **assistant** → 🚪 gatekeeper card. The rep uses it and gets put through.
3. **The CEO picks up.** 👋 opener card, tailored to a CEO who just raised.
4. **"What's this regarding?"**, played twice: once warm, once cold and short. **Two different cards.** The cold one is the self-aware joke.
5. **"We already have a broker."** 🛡️ objection card, with its success rate.
6. **The rep slips:** "that'd definitely be covered" → ⚠️ amber compliance card with a safe rephrase.
7. **Price question** → 🟢 buying signal → close card → **meeting booked**.
8. **After the call:** the playbook updates on screen (the lines used get their win), and the Mubit console shows the call as one session across four tasks, with the `write_line` adapter tested against the frontier model.

Before demo day we run simulated calls through Mubit so every task has passed the 25-example mark and has a trained adapter to show.

## 12. Stack

| Layer | Choice |
| --- | --- |
| Extension | Chrome MV3, side panel UI |
| Audio | `chrome.tabCapture` (prospect) + `getUserMedia` (rep) |
| Transcription | Streaming speech-to-text with speaker labels |
| Models | Frontier model through the Mubit gateway → Mubit adapters |
| Policy checks | Banyan Sapling, self-hosted on a GPU (~46 GB BF16; ~100 ms median on an H200) |
| Research | Exa search API |
| CRM + outcomes | HubSpot, Trellus dispositions |
| Dialer | Trellus (unchanged) |

## 13. Open questions

- **Serving adapters live.** Mubit's docs currently show adapters being tested in the console (*Try models*), not called from code. If live serving isn't available yet, the demo runs on the frontier model through Mubit and shows the adapter in the console. *Ask the Mubit team.*
- **Training on outcomes.** Could Mubit weight or filter training examples by "meeting booked"? Then the adapter could learn what books meetings directly, not only through the playbook. *Ask the Mubit team.*
- **Small samples.** A line needs enough calls behind it before its stats mean anything. Step-level wins (§6.2) give faster signal than meetings alone.
- **Sapling on insurance language.** Sapling is a research preview, and its model card notes insurance-claim examples coming back `unsure`. Expect a busy review list at first, and tune the policy wording.
- **Consent.** Call recording needs consent (two-party consent in some US states, and in the UK). Cue reads receptivity from **words**, not voice biometrics, and never labels a person's emotions.

## 14. Later

- **Voice tone** as a second receptivity signal, on top of the transcript
- **Playbooks per segment:** seed vs Series B, US vs UK, founder vs finance lead
- **Onboarding mode:** more guidance and the "why" behind each line for new reps; only the big moments for veterans
- **Manager view:** which lines win, who's using them, where new reps get stuck
- **Practice mode:** role-play against a simulated prospect built from real call patterns
