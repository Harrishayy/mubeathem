# Cue: a live sales coach that learns from every call

> Working name: **Cue**. A real-time assistant for sales reps. It listens to calls, reads the conversation as it happens, and prompts the rep with what has actually worked on their team's past calls. It learns from every call's outcome and checks every claim against company policy.

Built on **Mubit's gateway** and **Banyan Sapling**.

---

## 1. The problem

- **Sales knowledge lives in a few people's heads.** The best rep on the team knows exactly what to say when a CFO raises a price objection. Everyone else finds out the hard way, call by call.
- **Coaching happens too late.** Managers review a handful of recorded calls days afterwards. The moment that lost the deal is long gone.
- **Generic sales advice doesn't fit.** What works for one product, market or buyer type often fails for another. Teams need advice drawn from *their own* wins and losses.
- **Reps say things they shouldn't.** Under pressure, reps overpromise features, quote unapproved discounts or make claims that create legal risk. In regulated industries (finance, insurance, healthcare), one wrong sentence can be costly.



## 2. The product

**Cue sits alongside the rep during live calls.** It reads the conversation through four signals: what's said, conversation flow, voice tone and video. When a key moment comes up, it shows a short, specific prompt based on what worked in the team's past calls.

After the call, Cue logs the outcome and learns from it, so every call makes the next one better for the whole team.

**One-line pitch:** *Cue gives every rep the instincts of your best rep, in real time, and makes sure they never say something they shouldn't.*

### What the rep sees

Small, glanceable prompt cards that never interrupt the conversation:

> 💡 **Price objection**
> Ask: *"What does your current process cost you each month?"*
> Worked in 7 of 9 similar calls.

> 👥 **Decision maker signal**
> They've mentioned "my team" three times. Ask who else is involved in the decision.

> 📉 **Engagement dropping**
> Prospect has gone quiet since the pricing slide and is looking away from the camera. Pause and ask an open question.

> ⚠️ **Compliance**
> "Integrates with SAP" isn't in the product sheet. Correct it before the call ends.

Prompts are **short** (one line of advice), **specific** (tied to what just happened), **evidenced** (show how often it worked) and **rare** (only at moments that matter).

---



## 3. The four signals

Cue combines four signals into a live picture of the call. No single signal drives a prompt on its own; combining them reduces false alarms.

### 3.1 What's said (language)

Streaming transcription plus language analysis detects:

- **Objections:** price, timing, competitor, "not a priority", "need to check with…"
- **Buying signals:** "what would onboarding look like?", "how quickly could we start?", questions about contracts or pricing tiers
- **Competitor mentions** and current tools
- **Pain points:** problems the prospect describes in their own words
- **Decision process:** other stakeholders, budget cycles, approval steps
- **Rep claims:** product capabilities, pricing, guarantees and commitments (passed to the compliance check)



### 3.2 Conversation flow

How the conversation is moving, independent of content:

- **Talk ratio:** rep vs prospect speaking time (reps who dominate tend to lose)
- **Question rate:** how many questions the rep asks, and whether the prospect asks any
- **Monologues:** long uninterrupted stretches by either side
- **Interruptions** and overlapping speech
- **Response latency:** long pauses before the prospect answers
- **Engagement trend:** the prospect's share of the conversation rising or falling over time



### 3.3 Voice tone

Prosody analysis of the prospect's voice:

- **Energy and pace:** speeding up and getting louder vs slowing down and going flat
- **Pitch variation:** animated vs monotone
- **Hesitation markers:** "um", trailing off, restarts
- **Shift detection:** a clear change in tone after a specific moment (e.g. right after pricing is mentioned)

Tone is used as **shifts relative to that person's own baseline earlier in the call**, not as absolute judgements. A naturally quiet person isn't flagged as disengaged.

### 3.4 Video

On video calls, with consent, Cue analyses the prospect's camera feed for **engagement cues**:

- **Attention:** looking at the screen vs looking away, off-screen or multitasking
- **Facial expression changes:** for example, a frown or a smile at a specific moment
- **Nodding and visible reactions**
- **Presence:** leaving the frame, turning away, others joining on camera

Like tone, video is read as **change from that person's baseline** and always **combined with the other signals**. A single expression never triggers a prompt by itself. Cue reports *engagement cues* ("attention dropped after pricing") rather than claiming to know what someone feels.

### Combining the signals

Example: the prospect's **talk share falls** (flow), their **voice goes flat** (tone), they **look away from the screen** (video), all right after the rep **mentions price** (language). Together these are a strong signal, so Cue prompts: *"Engagement dropped after pricing. Pause and ask what's on their mind."*

---



## 4. How Cue learns



### 4.1 Outcomes

Every call gets an outcome, pulled from the CRM or set by the rep:

- Meeting booked / next step agreed
- Deal moved forward a stage
- Deal won / lost
- No clear next step



### 4.2 From outcomes to moments

Cue links each outcome back to **specific moments** in the call: the objection, what the rep did next, and how the prospect reacted across all four signals. Across many calls, this produces **lessons**:

> *"When a CFO raises price early, reps who asked about the cost of their current process (instead of offering a discount) booked a follow-up 70% of the time."*

> *"Calls where the rep spoke more than 65% of the time rarely progressed past the first meeting."*

> *"When prospects in logistics mentioned seasonal peaks, sharing the retail-peak case study led to a next step in 6 of 8 calls."*



### 4.3 Lesson store

Lessons are stored with:

- **The situation they apply to:** prospect role, industry, deal stage, objection type
- **Evidence:** how many calls support it, and the success rate
- **Status:** *candidate* (too little evidence) → *verified* (enough calls) → *retired* (stopped working)

Only **verified** lessons become live prompts. Candidates are shown to sales managers for review first. Lessons that stop working, because a market shifted or a competitor changed pricing, are automatically downranked and retired.

### 4.4 Team-wide learning

Lessons are shared across the whole sales team. When one rep discovers what handles a new competitor objection, every rep gets that prompt on their next call. A team of 50 reps learns 50 times faster than any individual.

---



## 5. How the Mubit gateway is used



### Why Cue needs it

Real-time prompts must appear **within a second or two**, while the moment is still live. Running a large frontier model on every few seconds of every call is too slow and too expensive at scale.

### How it works

1. **Every model call routes through Mubit's gateway**: one change to the API base URL.
  ```python
   from openai import OpenAI
   client = OpenAI(
       base_url="https://api.mubit.ai/openai/v1",
       api_key=os.environ["MUBIT_API_KEY"],
   )
  ```
2. **Cue's model calls are highly repetitive.** The same few jobs run thousands of times, each with a **fixed prompt and output format**, so Mubit groups them into clean tasks:
  - *Moment detection:* last 30 seconds of conversation + signal summary → detected moment (objection type, buying signal, engagement drop…)
  - *Prompt generation:* detected moment + matching lessons → one-line prompt
  - *Claim extraction:* rep's sentence → list of factual claims, for the compliance check
  - *Post-call lesson writing:* call summary + outcome → candidate lessons
3. **Teacher phase:** initially, a frontier model handles every task. Mubit records the calls.
4. **Mubit trains adapters**, small task-specific models tested against the frontier model's answers.
5. **Production:** live calls run on the adapters:
  - **Fast enough for real time**
  - **Cheap enough to run on every call** for every rep
  - **Trained on the team's own calls**, so the knowledge is built into the model rather than pasted into prompts
  - **Owned by the customer**, not rented from a model provider
6. **Continuous improvement:** new calls keep flowing through the gateway, so adapters can be retrained as the team's market and lessons evolve. Ideally they're trained on calls with **good outcomes**, so the model learns from what won.

The frontier model stays available as a fallback for unusual moments the adapters don't handle confidently.

---



## 6. How Banyan Sapling is used

Sapling checks claims against policy and evidence, returning `supported`, `violation`, `insufficient_information` or `inconsistent_context`, with a calibrated `unsure` status when it won't commit. Cue uses it in three places.

### 6.1 Live check on what the rep says

Each factual claim the rep makes is checked as it's said:

```
Policy:   "Only claim capabilities listed in the current product sheet.
           No guaranteed results. Discounts above 10% need manager approval."
Evidence: product sheet v4.2, price list, this prospect's CRM record
Claim:    "Our platform integrates natively with SAP."
```


| Sapling result             | Example                                      | Rep sees                                                       |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `supported`                | Claim matches the product sheet              | Nothing (no interruption)                                      |
| `violation`                | "Guaranteed 40% cost reduction"              | ⚠️ *"Guarantees aren't allowed. Rephrase as typical results."* |
| `insufficient_information` | "Integrates with SAP" (not in product sheet) | ⚠️ *"SAP integration isn't confirmed. Offer to follow up."*    |
| `inconsistent_context`     | Price list and contract template disagree    | ⚠️ Flagged to the sales ops team after the call                |
| status `unsure`            | Edge case                                    | Logged for manager review after the call, not shown live       |


Reps get a chance to **correct themselves before the call ends**, rather than a compliance problem surfacing weeks later.

### 6.2 Check on Cue's own prompts

Before any prompt is shown, Sapling checks it against the same policy, so Cue never coaches a rep into a violation (e.g. "offer 25% off to close today" when the limit is 10%).

### 6.3 Check on new lessons

A learning system will discover shortcuts. If overpromising books more meetings, the data will say "overpromise". Every new lesson is checked by Sapling before it can be verified and shared:

> Lesson: *"Offering 20% discounts on the first call doubles meeting rates."*
> → **violation** (discount policy) → quarantined, never shown to reps, flagged to managers.

**The result:** Cue learns to win **inside the rules**. The team gets better without becoming riskier.

---



## 7. Architecture

```
          Live call (audio + video)
                    │
     ┌──────────────┼───────────────────────────┐
     ▼              ▼              ▼            ▼
 Streaming      Conversation    Voice tone    Video
 transcription  flow metrics    analysis      engagement cues
     │              │              │            │
     └──────────────┴──────┬───────┴────────────┘
                           ▼
                 Signal fusion (rolling window)
                           │
                           ▼
          Moment detection ── via Mubit gateway (adapter)
                           │
              ┌────────────┴─────────────┐
              ▼                          ▼
     Lesson store lookup           Claim extraction ── via gateway
              │                          │
              ▼                          ▼
     Prompt generation             Sapling compliance check
       (via gateway)                     │
              │                          │
              ▼                          ▼
      Sapling check on prompt ──► Rep's prompt panel ◄── compliance flags
                           
          After the call:
     Outcome (CRM / rep) ──► link to moments ──► candidate lessons
          ──► Sapling check ──► manager review ──► verified lesson store
          All model calls ──► Mubit gateway ──► adapter retraining
```



### Real-time design principles

- **Prompts only at decision moments.** Cue never streams constant advice.
- **Latency budget:** prompt on screen within ~1–2 seconds of the moment.
- **Graceful degradation:** if any signal drops (camera off, poor audio), Cue keeps working on the rest. If the lesson store or models are unreachable, the call simply continues without prompts.
- **Prompts are suggestions.** The rep is always in control.

---



## 8. After the call

**For the rep:**

- A 30-second recap: key moments, what went well, one thing to try next time
- Compliance flags with suggested follow-up corrections (e.g. a follow-up email clarifying the SAP point)
- Auto-drafted follow-up email, also checked by Sapling before sending

**For managers:**

- **Team playbook:** verified lessons ranked by impact, with the calls behind them
- **Lesson review queue:** approve, edit or reject candidate lessons
- **Compliance dashboard:** violations caught, by rep and claim type, plus trends
- **Coaching view:** which reps use which prompts, and how outcomes change

---



## 9. Privacy, consent and trust

Built into the product, not bolted on:

- **Consent first:** all participants are notified that the call is recorded and analysed. Video analysis only runs when the prospect has consented; otherwise Cue uses language, flow and tone only.
- **Engagement cues, not mind-reading:** Cue reports observable changes ("attention dropped after pricing") and never labels a person's emotions or character. Cues always come from multiple combined signals.
- **Regional controls:** video and tone analysis can be switched off per region or customer to meet local rules (e.g. EU AI Act restrictions on emotion recognition, GDPR rules on biometric data, call-recording consent laws).
- **Data minimisation:** raw video isn't stored. Only derived, time-stamped engagement cues are kept, with configurable retention.
- **Reps aren't surveilled:** Cue analyses the *prospect's* engagement to help the rep. Rep-facing analytics focus on coaching, not monitoring.
- **Customer-owned models:** adapters trained through Mubit belong to the customer and are trained only on their data.

---



## 10. Who it's for

- **B2B sales teams** (SDRs and account executives) with repeatable sales motions
- **Regulated sales:** financial services, insurance, healthcare, where live compliance checks have direct value
- **Fast-growing teams** onboarding new reps who need to ramp quickly
- **Customer success and renewals teams:** the same product applied to churn and expansion calls



## 11. Business model

- **Per rep, per month** subscription
- **Compliance add-on** for regulated industries (live claim checking, audit trail, dashboards)
- **Enterprise tier:** custom policies, regional controls, dedicated adapters, CRM integrations

**Why customers stay:** Cue gets more valuable the longer it's used. The lesson store and trained models are built from the team's own calls, so switching away means losing their accumulated sales intelligence.

## 12. What makes Cue different


| Typical call tools                     | Cue                                                           |
| -------------------------------------- | ------------------------------------------------------------- |
| Analyse calls **after** they happen    | Coaches **during** the call                                   |
| Generic sales advice                   | Advice from **your team's own outcomes**                      |
| One signal (usually transcript)        | **Four signals combined:** language, flow, tone, video        |
| Large models, slow and costly per call | **Small trained models** via Mubit: fast enough for real time |
| Compliance reviewed weeks later        | **Live claim checking** with Sapling                          |
| Learning can drift into bad habits     | **Every lesson is policy-checked** before it spreads          |




## 13. Limits and open questions

- **Outcome noise:** deals are won or lost for many reasons beyond one call. Lessons need enough calls behind them to be trusted, which is why only verified lessons go live.
- **Signal reliability:** tone and video cues vary between people, cultures and setups (lighting, camera quality, accents). Cue relies on changes from each person's baseline and on combining signals, but cues remain probabilistic.
- **Sapling maturity:** Sapling is a research preview and often returns `unsure` on messy real-world text. Cue therefore holds uncertain cases for review after the call rather than interrupting live.
- **Latency:** real-time prompts depend on fast transcription and small models; the gateway adapters are essential to hit the latency budget.
- **Regulation:** rules on emotion recognition, biometric data and call recording differ by country and are changing. Regional controls and consent-first design are required from day one.



## 14. Roadmap

1. **v1:** language + flow signals, live prompts from verified lessons, live compliance checks, post-call recap
2. **v2:** voice tone, Mubit adapters in production for all real-time tasks, manager playbook and lesson review
3. **v3:** consented video engagement cues, regional controls, CRM-driven outcome tracking
4. **v4:** customer success and renewal calls; multilingual support; per-industry policy packs

