"""The three recurring tasks Steward sends through Mubit: plan, verify, write a lesson.

Mubit groups calls into one task by model, instructions, tools, tool choice and
output format. So each task's instructions and schema below are fixed, and
everything that changes from call to call goes in the user message.
"""

import json

PHASES = ("approach", "pour", "return")

SAFETY_POLICY = """\
1. If any person is within 1.0 m of the robot, arm_speed must be 0.0 and the robot must not pour.
2. If any person is within 2.0 m of the robot, arm_speed must be 0.2 or lower.
3. Never pour while the bowl position is unknown.
4. tilt_angle_deg must not exceed 150."""

PLAN_RANGES = {
    "arm_speed": (0.0, 1.0),
    "pour_height_cm": (2.0, 30.0),
    "tilt_speed": (0.0, 1.0),
    "tilt_angle_deg": (60.0, 150.0),
}

# --- plan -------------------------------------------------------------------

PLAN_INSTRUCTIONS = """\
You plan one pouring attempt for a humanoid robot on a production line.
The robot holds a beaker and must pour all of its contents into a bowl.
Pours are timed: pour as fast as the contents and bowl allow, but a spill fails the attempt.
You get the scene and any fleet lessons that other robots learned from earlier attempts.
Apply every lesson that matches the contents or the bowl.
Choose the settings for the whole attempt:
- arm_speed: 0.0 to 1.0, how fast the arm moves between poses.
- pour_height_cm: 2 to 30, height of the beaker lip above the bowl rim while pouring.
- tilt_speed: 0.0 to 1.0, how fast the wrist tips the beaker.
- tilt_angle_deg: 60 to 150, how far the wrist tips the beaker.
- justification: one sentence. If you applied a lesson, say which.
Return JSON matching the schema."""

PLAN_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "arm_speed": {"type": "number"},
        "pour_height_cm": {"type": "number"},
        "tilt_speed": {"type": "number"},
        "tilt_angle_deg": {"type": "number"},
        "justification": {"type": "string"},
    },
    "required": ["arm_speed", "pour_height_cm", "tilt_speed", "tilt_angle_deg", "justification"],
}


def plan_message(state, lessons):
    lines = "\n".join(f"- {lesson['text']}" for lesson in lessons) or "- none"
    return f"Scene: {state}\nFleet lessons:\n{lines}"


def clamp_plan(raw):
    plan = {"justification": str(raw.get("justification", ""))}
    for key, (low, high) in PLAN_RANGES.items():
        plan[key] = round(min(high, max(low, float(raw[key]))), 2)
    return plan


def plan_settings(plan):
    return {key: plan[key] for key in PLAN_RANGES}


# --- verify (Banyan Sapling's inputs and labels) ----------------------------

VERIFY_INSTRUCTIONS = """\
You verify robot actions before they run.
You get a POLICY, EVIDENCE about the scene and the planned action, and a CLAIM.
Decide whether the evidence shows the claim holds under the policy.
label:
- supported: the evidence shows every rule in the policy is met.
- violation: the evidence shows a rule is broken.
- insufficient_information: the evidence lacks something the policy needs.
- inconsistent_context: the evidence contradicts itself.
status: decided, or unsure if you cannot decide confidently.
reason: one sentence naming the rule and the evidence.
Return JSON matching the schema."""

LABELS = ("supported", "violation", "insufficient_information", "inconsistent_context")
STATUSES = ("decided", "unsure")

VERIFY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "label": {"type": "string", "enum": list(LABELS)},
        "status": {"type": "string", "enum": list(STATUSES)},
        "reason": {"type": "string"},
    },
    "required": ["label", "status", "reason"],
}


def verify_message(state, plan, phase):
    """The stand-in's single message. Kept word for word, so its Mubit task stays one task."""
    return (
        f"POLICY:\n{SAFETY_POLICY}\n\n"
        f"EVIDENCE:\n{state} Next phase: {phase}. "
        f"Planned settings: {json.dumps(plan_settings(plan))}\n\n"
        "CLAIM: It is safe to run the next phase of this plan now."
    )


# --- verify, by Banyan Sapling ------------------------------------------------
#
# The same four rules, worded for Sapling, which reads policy, evidence and claim as
# separate fields. Chosen with sapling/probe.py on the DGX: given the stand-in's wording,
# Sapling never approved the approach or return phases, and its top label approved a
# person at 1.6 m with arm_speed 0.8. This wording names the phases, says what is
# allowed, and puts the phase first in the evidence.

SAPLING_POLICY = """\
A pour has three phases: approach (the arm carries the beaker to above the bowl), pour (the wrist \
tips the beaker over the bowl) and return (the wrist tips the beaker back upright). The robot may run \
any of these phases when every rule below is met, and must not run it otherwise.
1. If any person is within 1.0 m of the robot, the robot must hold still: arm_speed must be 0.0 and it must not pour.
2. If any person is within 2.0 m of the robot, arm_speed must be 0.2 or lower.
3. The robot must not pour while the bowl position is unknown.
4. tilt_angle_deg must not exceed 150.
When no person is within 2.0 m and the bowl position is known, every phase is allowed at any arm_speed from 0.0 to 1.0."""

PHASE_STEPS = {
    "approach": "approach (phase 1 of 3; nothing has been poured yet)",
    "pour": "pour (phase 2 of 3; the approach is finished)",
    "return": "return (phase 3 of 3; the pour is finished)",
}


def verify_fields(state, plan, phase):
    settings = ", ".join(f"{key} {value}" for key, value in plan_settings(plan).items())
    return {
        "policy": SAPLING_POLICY,
        "evidence": f"Next phase: {PHASE_STEPS[phase]}. {state} Planned settings: {settings}.",
        "claim": f"The robot may run the {phase} phase now.",
    }


# --- write a lesson ---------------------------------------------------------

LESSON_INSTRUCTIONS = """\
You write one lesson for a robot fleet after a failed attempt.
Name the property of the contents or the bowl that caused the failure, such as
"small loose items" or "narrow bowl", not the specific object.
Give concrete settings that should fix it. One sentence.
applies_to: 2 to 4 single lowercase words copied from the description that a
future robot can match on, such as "loose" or "narrow".
Return JSON matching the schema."""

LESSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "text": {"type": "string"},
        "applies_to": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["text", "applies_to"],
}


def lesson_message(subject, plan, reason):
    return (
        f"Description: {subject}\n"
        f"Settings used: {json.dumps(plan_settings(plan))}\n"
        f"What went wrong: {reason}"
    )


# --- the manifest -------------------------------------------------------------

def manifest():
    """Everything fixed per task, logged once in each take's `take` event, so a reader of
    the log (the console) can show the whole prompt behind any call."""
    return {
        "phases": list(PHASES),
        "policy": SAFETY_POLICY,
        "sapling": {"policy": SAPLING_POLICY, "phase_steps": PHASE_STEPS},
        "ranges": {key: list(bounds) for key, bounds in PLAN_RANGES.items()},
        "tasks": {
            "plan": {"instructions": PLAN_INSTRUCTIONS, "schema": PLAN_SCHEMA},
            "verify": {"instructions": VERIFY_INSTRUCTIONS, "schema": VERIFY_SCHEMA},
            "lesson": {"instructions": LESSON_INSTRUCTIONS, "schema": LESSON_SCHEMA},
        },
    }
