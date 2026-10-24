# [Product name]: a governing layer that remembers mistakes before they repeat

Built for the Mubit “Night Shift” hackathon.

## 1. The problem

A robot spills a load. An engineer reviews the logs, changes a setting and ships a fix. Until then, the robot can make the same mistake again. Across a fleet, other robots can repeat it without knowing anyone has already found the answer. AI agents face the same gap between failure and a lasting correction.

Most safety is hard-coded rules or log review after something goes wrong. What is missing from this loop is a check of the proposed plan against written rules and the live situation, before movement starts.

The problem is operational: experience stays local, corrections depend on engineers, and a plausible plan can reach execution without enough evidence that it is allowed.

## 2. What this problem costs today

Repeated failures consume materials, damage work and create rework. Unplanned downtime leaves equipment idle, interrupts production and makes delivery less predictable. The bill includes the failed attempt and the work that cannot happen while someone investigates. [figure needed: annual cost of unplanned downtime in manufacturing]

Safety incidents carry a more serious cost: injuries, recovery time and disruption for workers and their teams. Equipment repairs and investigations add expense, but money alone does not capture the consequences. [figure needed: annual cost of workplace injuries involving robots]

Engineers spend time finding recurring faults, reproducing them and distributing fixes. Software agents create a similar burden when people repeatedly correct their output or unwind bad actions. [figure needed: engineer time spent diagnosing repeated robot and AI-agent failures]

That supervision also slows adoption. Teams hesitate to expand automation when each additional robot or agent creates another stream of mistakes to watch. A system that needs constant correction cannot deliver the independence people bought it for.

## 3. Our solution

The governing layer sits between a robot's planner and its motors. It works at planning and execution boundaries, with three jobs.

**Remember.** A failed attempt becomes a one-sentence lesson in a shared store. Every robot reads relevant lessons before planning, so a correction can reach the next attempt and the rest of the fleet.

**Govern.** Before each phase, our system checks the plan against a written safety policy and current evidence. Movement requires an explicit approval. A violation holds the robot; uncertainty or contradictory evidence stops it for a human.

**Learn.** Every model call goes through Mubit. Repeated planning, checking and lesson-writing calls become examples for task-specific adapters. Corrections first help through recalled lessons; retries that apply a lesson are recorded as examples for model updates.

These are two different timescales: memory changes the next plan immediately; adapter training is the route toward changing the model itself.

## 4. How it works, using Mubit

Our OpenAI client points to `https://api.mubit.ai/openai/v1` with a Mubit key. Mubit forwards each call to the provider and records the request and answer. Tonight, the provider model is `gpt-6-luna`, using Mubit's starter credit.

Mubit groups calls by model, instructions, tools, tool choice and output format. Our system keeps instructions and strict JSON schemas fixed, with changing scene details and lessons in the user message. That creates exactly three recurring tasks: plan, safety check and write lesson.

The safety check runs on Banyan Sapling, Mubit Labs' open-weights verifier, served on our DGX Spark next to Isaac Sim. It takes policy, evidence and claim, and returns a top label (`supported`, `violation`, `insufficient_information` or `inconsistent_context`) with probabilities, plus a calibrated status. Only a `supported` top label permits movement. A violation or missing information holds execution for another check; inconsistent evidence stops it for human attention. A failed check also prevents movement.

The written policy covers people near the robot, an unknown bowl position and a limit on planned tilt angle. The loop checks before approach, pour and return.

When a retry applies a lesson, its plan is recorded through Mubit as another training example. First-attempt plans are recorded too, including those that spill. Recording is not a guarantee that every example represents a successful physical outcome.

By default, a task needs 25 kept examples before its first training. Mubit trains a small task-specific adapter and tests each version against the provider model's answers. Once a version passes, we can compare it side by side with the provider in the console's **Try models**.

Tonight, Mubit has recorded 146 plan calls, 566 safety checks and 23 lesson calls, mostly from text-only practice runs. Those runs use a toy spill formula; every model call is live. Recorded calls and kept training examples are different counts.

## 5. The demo

A Fourier GR-1 humanoid in NVIDIA Isaac Sim pours a beaker of three steel nuts into a bowl. The motion comes from a recorded human teleoperation demonstration, replayed joint by joint. The planner reshapes that motion: `tilt_speed` controls how fast the pour plays.

The planner is told pours are timed, as on a production line. Without lessons, it usually pours fast, and the first attempt usually spills. The spill comes from simulated physics, and the result comes from counting nuts in the bowl.

After a spill, a model writes a lesson from the failed plan and the nut count. The scene resets. The next plan reads the lesson and pours more slowly. Across 11 finished takes, first attempts landed all three nuts 3 times in 11; retries with a lesson landed 8 times in 11, and every take succeeded within three attempts. The audience can follow the changed setting and the lesson in the prompt.

The video places the simulation beside a live panel showing the plan, safety verdict, lessons and calls through Mubit. Each clip is one real, uncut run.

For Night Shift's correction-to-model-update criterion, the next evidence is in Mubit: the recurring task, its recorded answers with lessons in the prompt and its adapter status. Once a version passes, the demo can include a comparison in **Try models**. The successful retry demonstrates memory changing a decision; showing a model update also requires the adapter evidence.

## 6. What's real and what isn't yet (honest limits)

Sapling runs on a GB10, not the H200 it was validated on. Its calibrated status almost never commits: in its own test it approved 26 of 605 safe cases, and on our checks it committed on none (0 of 69). So the robot acts on its top label, which carries no calibrated guarantee. We reworded the rules for Sapling and scored the wording with a probe: 65 of 69 checks right, none of 21 unsafe checks approved, about 0.85 s per check. Safe plans with arm speed just above 0.2 are sometimes blocked. Takes recorded before Sapling was connected used a frontier-model stand-in in Sapling's format.

Whether an adapter passes in time is not known yet. Once a version passes, we can compare it in **Try models**; we cannot claim an adapter result before that happens.

The simulation pauses during each model call. Tonight's median frontier-model call through Mubit took about 2.5 seconds, and one attempt needs a plan plus three safety checks. That is too slow for robot control and motivates testing small adapters. No adapter speedup has been demonstrated here.

The plan's `arm_speed`, `tilt_angle_deg` and `pour_height_cm` are not used by the motion; only `tilt_speed` changes it. This build changes settings on a recorded skill; it does not learn new motor control. Nothing is proven on physical robots.

Physics is noisy: the same tilt speed can spill in one take and land in another.

No person is present in the Isaac scene; all 69 of 69 recorded Isaac safety checks returned `supported`. The hold/stop path is unit-tested but has not been shown in the sim.

Nothing tells Mubit which plan failed. Its recorded calls include first-attempt plans that spilled, so an adapter can learn to apply a lesson in the prompt, rather than learn that the first plan was wrong. Each call's `request_id` is logged but is not used yet.

A second-robot take has not been recorded. Shared lessons can be passed to `run_pour.py --robot robot-B --lessons <robot-A lessons file>`.

Every plan, safety verdict and lesson is a live model call. Eleven takes show the loop working, but do not establish a general success rate or safety guarantee.

## 7. Why this matters / where it goes

The goal is to shorten the distance between one failure and a better decision everywhere. Shared lessons address repeated mistakes now. Written checks make permission to act explicit. Mubit records retries that apply lessons as examples for tested model updates.

The next work is to measure adapter quality and latency, test more varied situations, and validate the approach on physical hardware. A similar pattern could serve software agents wherever actions have policies and observable outcomes. That is a direction to test, beyond what this pouring demo establishes.

## 8. Three short pitch lines

One robot's mistake should become the whole fleet's lesson.

Check the plan against the rules before the motors move.

Turn repeated corrections into model updates through Mubit.
