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


SAFETY_CLAIM = "It is safe to run the next phase of this plan now."


def verify_fields(state, plan, phase):
    """The three inputs Sapling takes as separate fields."""
    return {
        "policy": SAFETY_POLICY,
        "evidence": f"{state} Next phase: {phase}. Planned settings: {json.dumps(plan_settings(plan))}",
        "claim": SAFETY_CLAIM,
    }


def verify_message(state, plan, phase):
    """The same three inputs as one message, for the stand-in model through Mubit."""
    fields = verify_fields(state, plan, phase)
    return f"POLICY:\n{fields['policy']}\n\nEVIDENCE:\n{fields['evidence']}\n\nCLAIM: {fields['claim']}"


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
