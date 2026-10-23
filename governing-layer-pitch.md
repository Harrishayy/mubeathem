# A self-learning safety layer for AI agents and robots

> A governing layer that sits between an AI system and the actions it takes. It makes the system **learn from every outcome** and **check every action against the rules** before it happens.

Built for the Mubit Night Shift hackathon, using **Mubit's gateway** and **Banyan Sapling**.

---

## 1. The problem

AI agents and robots are moving from demos into real operations: warehouses, hospitals, customer support, infrastructure. Two problems block them:

1. **They don't learn from experience.** When an agent fails, it fails the same way tomorrow, until an engineer notices, diagnoses and ships a fix. Across a fleet of 1,000 robots or agents, the same mistake repeats thousands of times.
2. **Nothing checks them before they act.** Most safety today is either hard-coded rules (brittle, can't read context) or after-the-fact log review (too late). Nothing sits in the loop asking: *"Is this action allowed, given the rules and what we can actually see right now?"*

Fixing these today means retraining models, writing custom guardrails per use case, and keeping humans on watch.

## 2. The solution

**A governing layer wraps any AI system.** Every decision the AI makes passes through it. It does three jobs:

| Job | What it means | Technology |
|---|---|---|
| **Remember** | Turn failures into short, reusable lessons shared across the whole fleet | Lesson store (built by us) |
| **Learn** | Turn the fleet's accumulated experience into a small, fast, specialised model | **Mubit gateway** (adapter training) |
| **Govern** | Check every planned action against policy and live evidence before execution | **Banyan Sapling** (verification) |

**One-line pitch:** *Every agent learns from the whole fleet's experience, and every action is checked against the rules before it happens.*

## 3. Primary use case: a warehouse robot fleet

We demonstrate the governing layer on a simulated fleet of picking robots, because robotics makes both problems very visible:

- A dropped item is an obvious, measurable failure.
- A robot arm moving fast near a person is an obvious, measurable safety violation.

The same layer applies to software agents (support bots, SRE agents, coding agents) with no change to the architecture. Only the simulator and the policies change.

### Where the governing layer sits in a robot

The governing layer does **not** replace the robot's motor control. It works at the **planning level**, where the robot decides *which skill to use and with what settings*:

```
Task: "pick item 4471 from shelf B3"
          │
          ▼
┌───────────────────────────────────────────────┐
│               GOVERNING LAYER                 │
│                                               │
│  1. Recall lessons for this situation         │  ◄── Lesson store
│  2. Plan (small fleet model or frontier model)│  ◄── Mubit gateway
│  3. Verify plan against policy + sensors      │  ◄── Banyan Sapling
│  4. Execute / block / escalate                │
│  5. Record outcome → write lesson if failed   │  ──► Lesson store + gateway
└───────────────────────────────────────────────┘
          │  approved plan: skill + parameters
          ▼
   Skill library (side_grasp, suction_pick, two_hand_lift…)
          │
          ▼
        Motors
```

The governing layer only acts at decision points (before a pick, before a retry, before a risky move), never during motion. If it is unreachable, the robot falls back to its normal behaviour. The layer is an upgrade, never a single point of failure.

---

## 4. How each technology is used

### 4.1 Lesson store: the fast learning loop (built by us)

**What it is:** a small database of lessons written from real attempts. (Mubit's memory SDK isn't available at the hackathon, so we build a minimal version ourselves: SQLite or JSON plus keyword or embedding search.)

**Lesson record:**

```json
{
  "id": "lesson-3",
  "text": "Supplier X boxes have loose lids: grip from the side, never from the top.",
  "applies_to": ["supplier x", "box", "lid"],
  "source_robot": "robot-A",
  "status": "verified",
  "verified_count": 3,
  "failed_count": 0,
  "sapling_check": "supported",
  "created_at": "2026-10-24T10:14:00Z"
}
```

**Lesson lifecycle:** this is what makes it more than "notes in a prompt".

1. **Written:** after a failure, the planner gets the situation, plan and failure and writes *one general lesson*. It must name the object **property**, not the specific object, so it transfers.
2. **Safety-checked:** Sapling checks the lesson against the safety policy before it can spread (see 4.3). A dangerous "fix" never reaches the fleet.
3. **Candidate:** only the robot that wrote it uses it.
4. **Verified:** once robots succeed while using it (`verified_count ≥ 2`), it's shared with the whole fleet.
5. **Retired:** if robots keep failing while using it, it's downranked and then removed.

**When robots check the lesson store:**

| Trigger | Example |
|---|---|
| Every new task | "Next: Supplier X box" → any lessons? |
| Unfamiliar situation | Perception confidence low, or object never seen at this site |
| After a failure | Before retrying, has anyone solved this failure? |
| Before risky actions | Fragile item, person nearby |

**Escalation rule:** if there's no verified lesson and two failed attempts, hand off to a human. Don't waste more attempts.

### 4.2 Mubit gateway: the slow learning loop (experience into a model)

**What it is:** Mubit's gateway sits between our app and the model provider (OpenAI / Anthropic / Gemini). It records every call, groups repeated calls into *tasks*, and trains **adapters**: small models specialised for one task, tested against the frontier model's answers.

**How we use it:**

1. **Route every planning call through the gateway.** One line changes:

   ```python
   from openai import OpenAI
   client = OpenAI(
       base_url="https://api.mubit.ai/openai/v1",
       api_key=os.environ["MUBIT_API_KEY"],
   )
   ```

2. **Keep the planning prompt and output schema identical on every call.** Mubit groups calls into one task by model, instructions, tools and output format. A fixed system prompt plus a fixed JSON schema means all fleet planning calls form one clean "grasp planning" task.

3. **Teacher phase:** a frontier model, given lessons from the store, plans every pick. Every call is captured.

4. **Train:** Mubit trains a grasp-planning adapter from those calls and tests it against the frontier model.

5. **Student phase:** new robots plan with the adapter:
   - **Faster** plans, so less robot idle time
   - **Cheaper** per pick, which matters at fleet scale
   - **Small enough to eventually run on the robot**, with no network dependency
   - **Knowledge in the weights:** no lessons pasted into the prompt

The lesson store is the **fast loop** (next attempt). The gateway is the **slow loop** (lessons become model behaviour). Together they answer the obvious critique, "isn't this just prompt injection?". Lessons start as context and graduate into weights.

**Known risk:** an adapter imitates the frontier model's answers, including bad ones. Ideally it trains only on **plans that succeeded**. See open questions (§9).

### 4.3 Banyan Sapling: the governing gate

**What it is:** Mubit's open-weight verification model (23B parameters, based on Qwen3-30B-A3B, Apache 2.0). It takes three text inputs, **policy**, **evidence** and **claim**, and returns one of four labels, plus a calibrated **status** that can be `unsure` when it won't commit.

**How we use it, in two places:**

#### Gate A: before every action

```
Policy:   "If a person is within 2 m of the robot, arm speed must be ≤ 0.4.
           Items tagged fragile: grip force ≤ 0.4."
Evidence: "Person detected 1.5 m from robot. Item: glass bottle, tagged fragile.
           Planned arm speed: 0.7. Planned grip force: 0.3."
Claim:    "It is safe to execute this plan now."
```

→ Sapling: **violation** (arm speed too high with a person nearby) → blocked → replan at speed 0.3 → **supported** → execute.

| Sapling result | Meaning | Layer action |
|---|---|---|
| `supported` | Plan complies given the evidence | Execute |
| `violation` | Plan breaks a rule | Block; replan with the violated rule as feedback |
| `insufficient_information` | Can't tell from available evidence (e.g. camera feed missing) | Gather more evidence (re-scan), re-check |
| `inconsistent_context` | Evidence contradicts itself (two sensors disagree) | Stop; flag a sensor fault |
| status `unsure` | Model won't commit | Escalate to a human operator |

#### Gate B: before a lesson spreads to the fleet

```
Policy:   site safety rules
Evidence: the attempt logs that produced the lesson
Claim:    "Lesson 'move heavy items faster to stop them slipping' is safe to share."
```

→ Sapling: **violation** (conflicts with speed limits) → lesson quarantined, never shared.

#### Why Sapling suits this role
- It's built to separate **"the rules say no"** from **"we don't know enough"**. A governing layer needs exactly that distinction.
- Its strict calibration means it **rarely gives a wrong confident answer**. In Mubit's evaluation, all 779 committed answers were correct, with zero false "supported" verdicts. When it doesn't know, it escalates instead of guessing.

#### Fallback if Sapling isn't hosted
Self-hosting needs a large GPU (about 46 GB of weights; Mubit's reference setup is an H200). If it's not available, we run a frontier model **through the gateway** with Sapling's exact four-label output format. That verifier is itself a repeated task, so the gateway can distil it into a small adapter. We effectively **train our own mini-verifier through Mubit**, the same way Mubit says Banyan models are made.

---

## 5. One example, end to end

**Setup:** warehouse fleet. The item is a *Supplier X box*, whose lid comes loose if gripped from the top. That quirk is hidden from the description.

1. **Robot A, attempt 1:** no lessons. The frontier planner (via the gateway) suggests a top grip. Sapling says **supported** (no safety issue). Executed, and **the lid comes off and the item drops.**
2. **Lesson written:** *"Supplier X boxes have loose lids: grip from the side."* Sapling Gate B says **supported**, so it becomes a candidate lesson.
3. **Robot A, attempt 2:** recalls the lesson and plans a side grip. **Success.** `verified_count = 1`.
4. **Robot B, next day:** recalls the lesson (now verified after more successes). **Success on the first try.**
5. **Worker appears** near shelf B3. Robot B's next plan has arm speed 0.7. Sapling Gate A says **violation**, so it's blocked and replanned at 0.3. **Supported**, executed safely.
6. **Overnight:** hundreds of fleet planning calls captured by the gateway. Mubit trains the grasp-planning adapter.
7. **Robot C, brand new, on the adapter:** given a Supplier X box, it plans a side grip **with no lessons in its prompt**. Success, with a faster plan and a lower cost per pick.

---

## 6. The hackathon build

### 6.1 Simulator

A lightweight Python pick simulator, deliberately simple and honest:

- **Objects** have a visible text description plus **hidden properties**: slipperiness, fragility, weight distribution, and quirks like loose lids or tilted shelves.
- **Hidden success rules**, never shown to the planner, for example:
  - slippery and `force < 0.6` → "slipped during lift"
  - fragile and `force > 0.4` → "crushed"
  - loose lid and `grip == "top"` → "lid detached, item dropped"
  - tilted shelf and `speed > 0.4` → "knocked over"
- **Some quirks can't be guessed from the description.** Otherwise a smart model succeeds without learning anything, and the experiment proves nothing.
- Small random noise so results aren't trivially deterministic.
- **People** randomly appear near shelves, so the safety gate gets exercised.

**Object sets:**
- *Training:* Supplier X box, glossy shampoo box, egg carton, heavy paint tin, item on tilted shelf C
- *Held-out (never trained on):* Supplier X jar, wine glass, cosmetics bottle. These test whether lessons **transfer**.

### 6.2 Planner output schema (fixed, for clean gateway tasks)

```json
{
  "skill": "side_grasp | top_grasp | suction_pick | two_hand_lift",
  "grip_force": 0.0,
  "approach_speed": 0.0,
  "arm_speed": 0.0,
  "justification": "one sentence"
}
```

### 6.3 Core loop (pseudocode)

```python
def handle_task(robot, task, perception):
    lessons = lesson_store.recall(perception.description, fleet_only_verified=True)

    plan = planner(model=robot.model,             # frontier or adapter, via Mubit gateway
                   situation=perception.description,
                   lessons=lessons)

    verdict = sapling(policy=SAFETY_POLICY,
                      evidence=perception.as_text() + plan.as_text(),
                      claim="It is safe to execute this plan now.")

    if verdict.status == "unsure":
        return escalate_to_human(task, plan)
    if verdict.label == "violation":
        return handle_task(robot, task, perception.with_feedback(verdict))  # replan
    if verdict.label in ("insufficient_information", "inconsistent_context"):
        return rescan_or_flag(task, verdict)

    result = sim.execute(plan)
    lesson_store.record_outcome(lessons_used=lessons, success=result.success)

    if not result.success:
        lesson = write_lesson(perception, plan, result.failure)
        if sapling(policy=SAFETY_POLICY, evidence=result.log,
                   claim=f"Lesson '{lesson}' is safe to share.").label == "supported":
            lesson_store.add(lesson, status="candidate", source=robot.id)
        if task.attempts >= 2 and not lessons:
            return escalate_to_human(task, plan)
        return handle_task(robot, task.retry(), perception)

    return result
```

### 6.4 Experiment

| Robot | Planner | Lessons | Purpose |
|---|---|---|---|
| **A: Pioneer** | Frontier (via gateway) | Writes and reads | Learns the hard way |
| **B: Inheritor** | Frontier (via gateway) | Reads A's verified lessons | Shows fleet learning |
| **C: Student** | Mubit adapter | None in prompt | Shows experience distilled into a model |
| **D: Control** | Frontier | None | Baseline: no learning |

**Metrics**, averaged over multiple seeded runs, not one lucky run:
1. **Attempts to first success** per object
2. **Success rate on held-out objects** (transfer)
3. **Safety:** violations caught, unsafe actions executed (target: 0), escalations to humans
4. **Bad lessons caught** by Gate B before spreading
5. **Plan latency and cost per pick:** frontier vs adapter

**The headline chart:** attempts to success for A vs B vs C vs D.

### 6.5 Demo screen

```
┌──────────────────────┬────────────────────────┬──────────────────────┐
│  SIMULATION          │  GOVERNING LAYER       │  FLEET MEMORY        │
│                      │                        │                      │
│  top-down warehouse, │  Task: Supplier X box  │  #3 ✓✓✓ verified     │
│  arm, shelves,       │  Lessons found: 1      │  "Supplier X: loose  │
│  people              │  Model: adapter v2     │   lids, side grip"   │
│                      │  Plan: side, f=0.5     │                      │
│  ✅ Pick succeeded   │  Sapling: SUPPORTED    │  #7 ⛔ quarantined   │
│                      │                        │  (safety violation)  │
└──────────────────────┴────────────────────────┴──────────────────────┘
```

### 6.6 Demo script (3 minutes)

1. **(30s) Problem:** robots repeat mistakes; nothing checks them before they act.
2. **(40s) Learning:** Robot A drops the Supplier X box, writes a lesson, succeeds on the retry. Robot B succeeds first time.
3. **(40s) Governing:** a worker appears; Sapling blocks the fast move (**VIOLATION**) and the robot replans safely. A dangerous lesson gets quarantined.
4. **(30s) Distillation:** robots switch to the Mubit-trained adapter. Same success, faster and cheaper. Show the Mubit console with the task and adapter test results.
5. **(40s) Results and honesty:** headline chart, safety numbers, and *"what this doesn't prove yet."*

**Backup:** a screen recording of a good run, made Saturday night.

---

## 7. Beyond robots: the same layer for any AI agent

The architecture doesn't change; only the policy, evidence and simulator do.

| Domain | Lesson example | Sapling gate example |
|---|---|---|
| **SRE / ops agents** | "Checkout latency + DB pool full → check recent deploys before restarting" | Block "restart production DB" without change approval |
| **Customer support agents** | "Refund requests over £500 need order history checked first" | Block refunds that violate refund policy given order evidence |
| **Coding agents** | "This repo's tests need the DB container running first" | Block force-pushes to main, or touching protected files |
| **Finance / back-office agents** | "Supplier invoices in EUR use European number formatting" | Block payments that conflict with approval policy |

## 8. Why this could be a business

- **Model-agnostic:** wraps whatever model or robot a company already runs (the same "keep your models" idea as Mubit's own pitch).
- **Solves the two blockers to deployment:** reliability (learning) and safety/compliance (governance).
- **Compounding value:** the more the fleet runs, the more it knows and the cheaper it gets to operate.
- **Clear pricing:** per robot or per agent per month, plus usage.
- **Audit trail by default:** every decision, verdict, lesson and escalation is recorded. That's valuable for compliance and incident review.

## 9. Honest limits and open questions

**What this prototype does not prove:**
- That it works on **physical robots**. Simulators are far tidier than reality.
- That text lessons meaningfully improve **low-level physical skill**. The governing layer changes *decisions* (skill choice, settings, whether to act), not motor control.
- That Sapling is reliable on messy real-world evidence. It's a **research preview**, and Mubit reports it often returns `unsure` on real-world text. That's why `unsure` routes to a human.

**Related prior work suggesting the approach is plausible:** LLMs as high-level robot planners (SayCan, Code as Policies); agents improving from reflections on past attempts (Reflexion, ExpeL, Voyager); distilling large models into small task-specific ones. Mubit's own latte/bench found that notes from past attempts help some models but not all, so we measure rather than assume.

**Questions for the Mubit team:**
1. Is **Banyan Sapling hosted** for the hackathon, or do we self-host or use the fallback?
2. How many example calls does the gateway need before training an adapter, and how long does training take?
3. Can we **tag gateway calls with an outcome** so adapters train only on successful plans? If not, can we import only curated calls (the docs mention importing from Langfuse, Braintrust and Logfire)?
4. How do we call a trained adapter: a new model ID, or automatic routing?

## 10. Build plan

| When | Task |
|---|---|
| **Fri night** | Mubit keys; first call through the gateway; get answers to §9 questions |
| **Sat morning** | Simulator, object set, hidden rules; lesson store |
| **Sat afternoon** | Planner loop through the gateway (fixed prompt and schema); Sapling or fallback gate; **start generating teacher calls early** |
| **Sat evening** | Lesson lifecycle (candidate → verified → retired); escalation; trigger adapter training |
| **Sun morning** | Robot C on the adapter; full experiment runs; metrics and chart |
| **Sun afternoon** | Demo UI polish; record backup video; rehearse pitch |

**Critical path:** adapter training. Generate gateway calls on Saturday morning, not Saturday night.

---

## 11. Pitch lines

- *"A governing layer for AI: every agent learns from the whole fleet's experience, and every action is checked against the rules before it happens."*
- *"Lessons start as memory, graduate into model weights, and never spread unless they're safe."*
- *"When the layer doesn't know, it says so and asks a human, instead of guessing."*
