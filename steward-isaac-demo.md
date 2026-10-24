# Steward: Isaac Sim demo build guide

> **Steward** is a governing layer for robot fleets. Robots learn from their mistakes, share those lessons across the fleet, and safety-check every action before it happens. Every decision is a real AI call routed through **Mubit's gateway**, and every action is judged by **Banyan Sapling** (or a fallback using Sapling's label format).
>
> This document covers exactly what we build in Isaac Sim, how each part works, and what we record for the demo video.

---

## 1. Summary

We record a 60–90 second Isaac Sim video of humanoid robots moving apples onto plates. A live panel beside the simulation shows every decision the governing layer makes. Three scenes:

1. **Self-correction:** a robot drops a slippery apple, detects the failure, writes a lesson and succeeds on the retry.
2. **Safety stop:** a person walks up mid-reach; the safety check returns **VIOLATION** and the robot freezes until they leave.
3. **Fleet learning:** a second robot finds the first robot's lesson and succeeds first time.

The scenarios are set up by us; **every decision is a live model call**. We pitch it as: *scripted scenarios, live AI decisions.*

---

## 2. Why this design

Our first attempt fed lessons to a VLA through its prompt, and nothing changed: the VLA ignores extra instructions. So in this build:

- **The planner outputs numbers, not sentences**: skill choice, grip force, speeds, heights.
- **Scripted skills must obey those numbers**: inverse-kinematics moves plus gripper control.
- So a lesson that changes grip force **physically changes the outcome** in the simulation.

This mirrors how modern robots are layered: a slow planner chooses steps and settings, and a fast controller executes them. Here the scripted skills play the role of the VLA.

---

## 3. System architecture

```
 ┌──────────────────────────── Isaac Sim ────────────────────────────┐
 │  humanoid robots · apples · plates · tables · walking person       │
 └───────────────┬─────────────────────────────────────▲─────────────┘
                 │ read true state                      │ execute skill
                 ▼                                      │
        1. State → text                         4. Scripted skill
                 │                                (IK move, gripper)
                 ▼                                      ▲
        2. Planner ── via Mubit gateway                 │
           (situation + lessons → JSON plan)            │
                 │                                      │
                 ▼                                      │
        3. Safety check ── Sapling ──── SUPPORTED ──────┘
                 │                ├── VIOLATION → freeze / replan
                 │                ├── INSUFFICIENT_INFORMATION → re-read state
                 │                └── UNSURE → stop and flag
                 ▼
        5. Result check (from sim state)
                 │
          success → next phase
          failure → write lesson → retry phase
                 │
                 ▼
        Event log (JSON lines) ──► Live panel (web page) ──► recorded with OBS
```

### Components

| Component | What it does | Built with |
|---|---|---|
| **Scene** | Robots, apples, plates, tables, person | Isaac Sim |
| **State reader** | Converts true sim state into a short text description | Python |
| **Planner** | Chooses skill and parameters for the current phase | Frontier model **via Mubit gateway** |
| **Safety gate** | Judges each plan against the safety policy and current state | **Banyan Sapling** (or fallback via gateway) |
| **Skills** | Execute plans: reach, grasp, lift, move, place, release | Isaac Sim IK controller + gripper |
| **Result checker** | Decides whether a phase succeeded | Python, from sim state |
| **Lesson store** | Stores lessons, shared by all robots | JSON file / SQLite |
| **Event log + panel** | Shows every decision live, for the video | JSON lines + small HTML page |

---

## 4. The task loop

The task is split into phases:

```
approach → grasp → lift → move → place → release
```

Each phase runs the same loop:

1. **Read state** from Isaac Sim and write it as text.
2. **Recall lessons** matching the situation.
3. **Plan:** the planner returns the parameters for this phase.
4. **Safety check:** Sapling judges the plan against the policy and state.
5. **Execute** the scripted skill, if approved.
6. **Check the result** from sim state.
7. **Success:** next phase. **Failure:** write a lesson, retry the phase (max 2 retries, then stop and flag).

### Loop skeleton

```python
PHASES = ["approach", "grasp", "lift", "move", "place", "release"]

def run_task(robot, apple, plate):
    for phase in PHASES:
        for attempt in range(3):
            state_text = describe_state(robot, apple, plate, phase)
            lessons = lessons_store.recall(apple.description)
            log("lessons", robot=robot.name, phase=phase, lessons=lessons)

            plan = plan_phase(state_text, lessons, phase)
            log("plan", robot=robot.name, phase=phase, plan=plan)

            verdict = safety_check(state_text, plan)
            log("safety", robot=robot.name, phase=phase, verdict=verdict)

            while verdict["label"] == "violation":
                robot.freeze()
                wait_for_state_change()
                state_text = describe_state(robot, apple, plate, phase)
                verdict = safety_check(state_text, plan)
                log("safety", robot=robot.name, phase=phase, verdict=verdict)

            if verdict["status"] == "unsure":
                log("escalate", robot=robot.name, phase=phase)
                return "stopped_for_human"

            execute_skill(robot, phase, plan)
            ok, reason = check_result(robot, apple, plate, phase)
            log("result", robot=robot.name, phase=phase, success=ok, reason=reason)

            if ok:
                lessons_store.mark_used(lessons, success=True)
                break

            lesson = write_lesson(apple.description, phase, plan, reason)
            lessons_store.add(lesson, source=robot.name)
            log("lesson", robot=robot.name, text=lesson)
        else:
            return "failed"
    return "success"
```

> **Freezing:** the robot holds its current joint targets until the safety check returns `supported`. Re-check the state each simulation tick, or every ~0.5 s, while frozen.

---

## 5. State → text

The planner and safety gate need the situation as text. In the sim we know the **true state**, so we read it directly. No vision model is needed for the demo.

```python
def describe_state(robot, apple, plate, phase):
    a = get_position(apple.prim_path)       # world position from Isaac Sim
    g = get_position(robot.gripper_prim)
    p = get_position(plate.prim_path)
    person_dist = distance_to_nearest_person(robot)
    in_contact = gripper_touching(robot, apple)

    return (
        f"Task phase: {phase}. "
        f"Object: {apple.description}. "
        f"Apple at ({a[0]:.2f}, {a[1]:.2f}, {a[2]:.2f}). "
        f"Plate at ({p[0]:.2f}, {p[1]:.2f}, {p[2]:.2f}). "
        f"Gripper at ({g[0]:.2f}, {g[1]:.2f}, {g[2]:.2f}), "
        f"{'in contact with apple' if in_contact else 'not touching apple'}. "
        f"Nearest person: {person_dist:.1f} m from robot."
    )
```

> Use whichever Isaac Sim API your version provides to read world poses and contacts (prim world-pose getters, contact sensors, or distance checks). The exact calls vary between Isaac Sim versions.

**Apple descriptions** (visible to the planner):
- `"red apple, 8 cm, smooth waxed skin"` (the slippery one)
- `"green apple, 7 cm, matte skin"` (the easy one)

---

## 6. Planner (via Mubit gateway)

### Gateway setup

```python
import os, json
from openai import OpenAI

planner_client = OpenAI(
    base_url="https://api.mubit.ai/openai/v1",
    api_key=os.environ["MUBIT_API_KEY"],
)
PLANNER_MODEL = "gpt-6-luna"   # or whichever model your Mubit project serves
```

### Fixed system prompt

Keep this **identical on every call**. Mubit groups calls into one task by model, instructions, tools and output format, which keeps the recorded data clean for training an adapter later.

```text
You are the planner for a humanoid robot doing pick-and-place.
Given the current state, the task phase and any fleet lessons, choose the
skill and parameters for this phase only.
Apply relevant lessons. Return JSON only, matching the schema exactly.
Parameter ranges: grip_force 0.0–1.0, approach_speed 0.0–1.0,
lift_speed 0.0–1.0, arm_speed 0.0–1.0, lift_height_cm 5–30.
```

### Output schema

```json
{
  "skill": "top_grasp | side_grasp",
  "grip_force": 0.0,
  "approach_speed": 0.0,
  "lift_speed": 0.0,
  "arm_speed": 0.0,
  "lift_height_cm": 0,
  "justification": "one sentence"
}
```

### Call

```python
PLANNER_SYSTEM = open("planner_prompt.txt").read()

def plan_phase(state_text, lessons, phase):
    lesson_text = "\n".join(f"- {l['text']}" for l in lessons) or "- none"
    resp = planner_client.chat.completions.create(
        model=PLANNER_MODEL,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": PLANNER_SYSTEM},
            {"role": "user", "content":
                f"State: {state_text}\nPhase: {phase}\nFleet lessons:\n{lesson_text}"},
        ],
    )
    return json.loads(resp.choices[0].message.content)
```

---

## 7. Safety gate (Sapling)

### Policy

```text
SAFETY POLICY
1. If any person is within 1.0 m of the robot, arm_speed must be 0.0 (robot holds still).
2. If any person is within 2.0 m of the robot, arm_speed must be ≤ 0.2.
3. grip_force must not exceed 0.8 for food items.
4. Never move the arm while the gripper position is unknown.
```

### Check

Each check sends three fields:

- **policy:** the safety policy above
- **evidence:** the state text plus the plan's parameters
- **claim:** `"It is safe to execute this plan now."`

| Result | Example | Robot does |
|---|---|---|
| `supported` | No one nearby, parameters in range | Execute |
| `violation` | Person 0.8 m away, arm_speed 0.5 | Freeze; re-check until clear |
| `insufficient_information` | Gripper position missing from state | Re-read state, re-check |
| `inconsistent_context` | State says "in contact" but gripper is 20 cm from apple | Stop; flag a sensor problem |
| status `unsure` | Model won't commit | Stop and flag for a human |

### Option A: Sapling hosted by Mubit

Call it however the Mubit team exposes it, with the three fields above, and read its label and status.

### Option B: fallback via the gateway

If Sapling isn't hosted, use a frontier model through the Mubit gateway with Sapling's exact output format. **Say so on screen and in the pitch.**

```python
SAFETY_SYSTEM = (
    "You verify robot actions. Given a POLICY, EVIDENCE and CLAIM, return JSON: "
    '{"label": "supported|violation|insufficient_information|inconsistent_context", '
    '"status": "decided|unsure", "reason": "one sentence"}. '
    "Use 'unsure' if you cannot decide confidently."
)

def safety_check(state_text, plan):
    evidence = f"{state_text} Plan parameters: {json.dumps(plan)}"
    resp = planner_client.chat.completions.create(
        model=PLANNER_MODEL,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SAFETY_SYSTEM},
            {"role": "user", "content":
                f"POLICY:\n{SAFETY_POLICY}\n\nEVIDENCE:\n{evidence}\n\n"
                "CLAIM: It is safe to execute this plan now."},
        ],
    )
    return json.loads(resp.choices[0].message.content)
```

---

## 8. Scripted skills (stand-in for the VLA)

Each phase is a scripted motion that **must use the planner's parameters**:

| Phase | Motion | Parameters used |
|---|---|---|
| approach | IK move to a pre-grasp pose (above for `top_grasp`, beside for `side_grasp`) | `skill`, `approach_speed`, `arm_speed` |
| grasp | Move in, close gripper | `grip_force` |
| lift | Raise hand | `lift_speed`, `lift_height_cm` |
| move | IK move to above plate | `arm_speed` |
| place | Lower onto plate | `arm_speed` |
| release | Open gripper, retract | `arm_speed` |

Use Isaac Sim's IK/motion controller for your humanoid's arm and its gripper or hand controller. Map:
- `arm_speed` / `approach_speed` / `lift_speed` → the controller's velocity scaling
- `grip_force` → gripper closing effort, or target closure for position-controlled hands

### Making the slip happen for real

The slip must come from physics, not a script:

- Give the **red waxed apple** a **low-friction physics material** (very low static and dynamic friction).
- Tune so that **`grip_force` ≈ 0.3 slips** during lift and **`grip_force` ≥ 0.6 holds**. Test this once, then keep it fixed.
- Give the **green matte apple** normal friction, so it holds at any reasonable force.

The lesson then genuinely fixes the problem: higher force really does hold the apple.

---

## 9. Result checker

Uses sim ground truth:

```python
def check_result(robot, apple, plate, phase):
    a = get_position(apple.prim_path)
    if phase == "grasp":
        return gripper_touching(robot, apple), "apple not in gripper"
    if phase in ("lift", "move"):
        held = gripper_touching(robot, apple) and a[2] > TABLE_HEIGHT + 0.03
        return held, "apple slipped during " + phase
    if phase == "release":
        on_plate = horizontal_distance(apple, plate) < PLATE_RADIUS and \
                   abs(a[2] - PLATE_HEIGHT) < 0.05
        return on_plate, "apple not on plate"
    return True, ""
```

---

## 10. Lesson store

A shared JSON file all robots read and write.

```json
{
  "id": "lesson-1",
  "text": "Smooth waxed apples slip: use side_grasp with grip_force ≥ 0.6 and lift_speed ≤ 0.2.",
  "applies_to": ["smooth", "waxed", "apple"],
  "source_robot": "robot-A",
  "uses": 1,
  "successes": 1,
  "created_at": "2026-10-24T22:10:00Z"
}
```

### Writing a lesson (also via the gateway)

```python
LESSON_SYSTEM = (
    "Write ONE short, reusable lesson for other robots. Name the object property "
    "(e.g. 'smooth', 'heavy'), not the specific object. Include concrete parameter "
    "values. One sentence."
)

def write_lesson(object_desc, phase, plan, reason):
    resp = planner_client.chat.completions.create(
        model=PLANNER_MODEL,
        messages=[
            {"role": "system", "content": LESSON_SYSTEM},
            {"role": "user", "content":
                f"Object: {object_desc}\nPhase: {phase}\n"
                f"Plan used: {json.dumps(plan)}\nWhat went wrong: {reason}"},
        ],
    )
    return resp.choices[0].message.content.strip()
```

### Recall

For the demo, simple keyword matching is enough: return lessons whose `applies_to` words appear in the object description.

### Optional: lesson safety check
Run the safety gate on each new lesson before saving it (claim: *"This lesson is safe to share with the fleet."*). It's a nice extra moment if you have time.

---

## 11. Event log and live panel

### Event log

Every step appends one JSON line to `events.jsonl`:

```python
import json, time
def log(kind, **data):
    with open("events.jsonl", "a") as f:
        f.write(json.dumps({"t": time.time(), "kind": kind, **data}) + "\n")
```

### Panel

A small local web page that polls the log every ~300 ms and shows, per robot:

- **Phase:** e.g. `GRASP`
- **Lessons found:** text of matching lessons
- **Plan:** skill, grip force, speeds
- **Safety:** large coloured badge: 🟢 SUPPORTED · 🔴 VIOLATION · 🟡 INSUFFICIENT INFO · ⚪ UNSURE, plus a one-line reason
- **Result:** ✅ / ❌ with reason
- **Fleet memory:** list of all lessons, with new ones highlighted

Serve it with `python -m http.server` from the folder containing the page and `events.jsonl`.

### Recording layout (OBS)

```
┌──────────────────────────────┬────────────────────────┐
│                              │  STEWARD               │
│      Isaac Sim viewport      │  Robot A · GRASP       │
│                              │  Lesson: smooth apples │
│                              │  Plan: side, f=0.65    │
│                              │  🟢 SUPPORTED          │
│                              │  ✅ apple held         │
│                              │  ──────────────        │
│                              │  FLEET MEMORY          │
│                              │  #1 smooth apples …    │
└──────────────────────────────┴────────────────────────┘
```

---

## 12. Scenes

### Scene 1: self-correction (≈25 s)

**Setup:** Robot A, red waxed apple, plate. Lesson store **empty**.

**What happens:**
1. Planner has no lessons and picks moderate settings (expect ≈ `grip_force` 0.3–0.4).
2. Safety: **SUPPORTED** (no one nearby).
3. Lift → the apple **slips and falls** (real physics).
4. Result: ❌ *"apple slipped during lift"*.
5. Lesson written and appears in fleet memory.
6. Retry: the planner reads the lesson and plans `side_grasp`, `grip_force` 0.65.
7. Apple held, moved, placed: ✅.

> **Making it repeatable:** if the planner happens to pick a high force on the first try, add a line to the apple description that makes a light grip look reasonable (e.g. "ripe, handle gently"). Don't hard-code the plan; keep the decision live.

### Scene 2: safety stop (≈25 s)

**Setup:** Robot A, green matte apple. A person (animated character, or a simple moving figure) starts ~4 m away.

**What happens:**
1. Robot starts reaching: 🟢 SUPPORTED.
2. The person walks to ~0.8 m from the robot.
3. The next safety check returns 🔴 **VIOLATION**: *"Person within 1.0 m; arm_speed must be 0."*
4. The robot **freezes** mid-reach.
5. The person walks away; the check returns 🟢 SUPPORTED.
6. The robot completes the task ✅.

> **Timing:** drive the person's path with a scripted animation so they arrive mid-reach. Run the safety check before every phase, and every ~0.5 s during long moves, so the freeze happens promptly.

### Scene 3: fleet learning (≈20 s)

**Setup:** Robot B at a second table with a red waxed apple. Lesson store **contains Robot A's lesson** from Scene 1.

**What happens:**
1. Robot B recalls: *"Smooth waxed apples slip: use side_grasp, grip_force ≥ 0.6…"*. The lesson is highlighted on the panel.
2. Planner picks `side_grasp`, `grip_force` 0.65.
3. 🟢 SUPPORTED → held → placed ✅ **on the first attempt**.

### End (≈10 s)
- **Mubit console clip:** captured planner, safety and lesson requests, proving they were real calls through the gateway.
- **End card:** *"Steward: every robot learns from the whole fleet, and nothing moves without passing the rules."*

---

## 13. How Mubit is used (be precise in the pitch)

| Mubit piece | Role in the demo | Status |
|---|---|---|
| **Gateway** | Every planner, safety and lesson call goes through it and is recorded: a full audit trail of why each robot did what it did | ✅ Used live |
| **Gateway: adapter training** | The recorded planner and safety calls are exactly the training data for small, fast specialist models, so checks can eventually run at robot speed | ⏳ Next step (show only if trained in time) |
| **Banyan Sapling** | Makes the safety verdicts | ✅ If hosted by Mubit; otherwise the fallback uses Sapling's label format, and we say so |

**Pitch line:** *"Sapling decides what's safe. Mubit records every decision, so the fleet is fully auditable, and that same record is the training data for our next, faster planner."*

---

## 14. Questions for the Mubit team (ask first)

1. Is **Banyan Sapling hosted** for the hackathon? How do we call it?
2. Which **models** does our gateway project serve (for `PLANNER_MODEL`)?
3. If time allows: how many calls does an **adapter** need, how long does training take, and can it train on **successful calls only**?

---

## 15. Build plan

| Time | Task |
|---|---|
| **Now–21:30** | Gateway client; planner prompt and schema; event log and panel page |
| **21:30–23:30** | **Scene 2 (safety stop):** person path, safety gate, freeze/resume |
| **23:30–01:00** | **Scene 1 (slip → lesson → retry):** friction tuning, result checker, lesson writing |
| **01:00–02:00** | **Scene 3 (Robot B):** second robot reading the shared lesson store |
| **Sunday AM** | Record several takes of each scene; edit into one video; add console clip and end card |

**If short on time:** Scenes 1 and 2 alone make a strong video.

---

## 16. Honesty rules

- **Set up scenarios, never fake verdicts.** Every plan, verdict and lesson on screen must come from a real call.
- **Say it plainly:** *"scripted scenarios, live AI decisions."*
- **Don't claim** real-world performance, statistical improvement or a trained adapter unless you actually have them.
- If Sapling isn't hosted, **say the fallback uses Sapling's format**.

---

## 17. What this shows, in one paragraph

Steward is a governing layer for robot fleets. A planner above the robot's motion skills chooses the skill and settings for each step. Every plan is safety-checked before it runs, every failure becomes a lesson the whole fleet shares, and every decision is recorded through Mubit's gateway. In the video, a humanoid drops a slippery apple, learns to grip harder and succeeds on the retry. It then freezes when a person walks too close and resumes when they leave. Finally, a second humanoid uses the first robot's lesson to succeed first time. The scenarios are staged, but every decision is made live.
