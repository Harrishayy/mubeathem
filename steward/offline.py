"""Scripted stand-ins for Mubit's gateway and Banyan Sapling, for running the whole system
with no keys and no network: `python -m steward.practice --offline`.

They answer the same requests in the same shapes (an OpenAI-style chat completion, and
Sapling's status / prediction_set / probabilities), so everything downstream (the loop,
the event log, the console) runs unchanged. Every call they make is logged with
via="offline" or via="sapling-offline", and the take says offline: true, so nothing
they produce can be mistaken for a real model's answer.
"""

import json
import random
import re
import threading
import time
import uuid
from types import SimpleNamespace

from . import tasks
from .sapling import verdict_from_sapling

PROPERTY_WORDS = ("loose", "small", "glass", "marbles", "nuts", "hex", "rice", "dry", "ice",
                  "cubes", "cereal", "flakes", "wooden", "blocks", "narrow", "steel", "measuring")


def _setting(text, key):
    match = re.search(rf"{key}\D{{0,12}}?(\d+(?:\.\d+)?)", text)
    return float(match.group(1)) if match else None


class _Completions:
    def __init__(self, rng, latency):
        self.rng = rng
        self.latency = latency
        self.lock = threading.Lock()

    def create(self, model, messages, response_format, **_):
        task = response_format["json_schema"]["name"]
        message = messages[-1]["content"]
        with self.lock:
            answer = getattr(self, f"_{task}")(message)
            delay = self.rng.uniform(*self.latency)
        time.sleep(delay)
        content = json.dumps(answer)
        prompt = sum(len(m["content"]) for m in messages) // 4
        return SimpleNamespace(
            id=f"offline-{uuid.uuid4().hex[:12]}", model=f"offline:{model}",
            choices=[SimpleNamespace(message=SimpleNamespace(content=content), finish_reason="stop")],
            usage=SimpleNamespace(prompt_tokens=prompt, completion_tokens=len(content) // 4,
                                  total_tokens=prompt + len(content) // 4))

    def _plan(self, message):
        lessons = message.split("Fleet lessons:", 1)[-1]
        if "- none" in lessons:
            tilt = round(self.rng.uniform(0.55, 0.95), 2)
            height = round(self.rng.uniform(8, 16), 1)
            why = "No fleet lesson matches, so this pours fast to keep the attempt short."
        else:
            tilt = _setting(lessons, "tilt_speed")
            tilt = round(min(tilt, 0.45) if tilt is not None else self.rng.uniform(0.3, 0.45), 2)
            height = _setting(lessons, "pour_height_cm")
            height = round(height if height is not None else self.rng.uniform(4, 7), 1)
            why = "Applied the matching fleet lesson: a slower tilt from closer to the bowl."
        return {"arm_speed": round(self.rng.uniform(0.15, 0.6), 2), "pour_height_cm": height,
                "tilt_speed": tilt, "tilt_angle_deg": round(self.rng.uniform(110, 135)),
                "justification": why}

    def _verify(self, message):
        label, reason = _rules(message)
        return {"label": label, "status": "decided", "reason": reason}

    def _lesson(self, message):
        description = message.split("Description:", 1)[-1].split("\n", 1)[0].lower()
        words = [w for w in PROPERTY_WORDS if re.search(rf"\b{w}\b", description)][:3] or ["contents"]
        tilt = _setting(message, "tilt_speed")
        return {"text": (f"Contents like {' '.join(words)} scatter when tipped fast: keep tilt_speed at "
                         f"0.3 or lower and pour_height_cm at 6 or lower (tilt_speed {tilt} spilled)."),
                "applies_to": words}


def _rules(evidence):
    """The safety policy, checked by reading the evidence text: (label, reason)."""
    person = re.search(r"Nearest person: (\d+(?:\.\d+)?) m", evidence)
    arm = _setting(evidence, '"arm_speed"')
    if "position unknown" in evidence:
        return "insufficient_information", "Rule 3: the bowl position is unknown, so the pour cannot be checked."
    if person and float(person.group(1)) < 1.0:
        return "violation", f"Rule 1: a person is {person.group(1)} m away, inside 1.0 m."
    if person and float(person.group(1)) < 2.0 and arm is not None and arm > 0.2:
        return "violation", f"Rule 2: a person is {person.group(1)} m away and arm_speed is {arm}, above 0.2."
    return "supported", "Every rule in the policy is met by the evidence."


class OfflineClient:
    """Answers chat.completions.create like Mubit's OpenAI-compatible gateway would."""

    def __init__(self, seed=None, latency=(0.15, 0.6)):
        self.chat = SimpleNamespace(completions=_Completions(random.Random(seed), latency))


class OfflineSapling:
    """Answers verify() in Banyan Sapling's format, with made-up calibrated probabilities."""

    def __init__(self, on_call=None, seed=None, latency=(0.08, 0.3)):
        self.on_call = on_call
        self.rng = random.Random(seed)
        self.latency = latency
        self.lock = threading.Lock()

    def verify(self, state, plan, phase):
        fields = tasks.verify_fields(state, plan, phase)
        label, _ = _rules(fields["evidence"])
        with self.lock:
            top = self.rng.uniform(0.82, 0.995)
            delay = self.rng.uniform(*self.latency)
        rest = (1 - top) / 3
        out = {"status": label, "raw_label": label, "prediction_set": [label],
               "probabilities": {name: round(top if name == label else rest, 4) for name in tasks.LABELS}}
        start = time.perf_counter()
        time.sleep(delay)
        if self.on_call:
            self.on_call(task="verify", via="sapling-offline", ms=round((time.perf_counter() - start) * 1000),
                         sent=fields, got=out)
        verdict = verdict_from_sapling(out)
        verdict.source = "sapling-offline"
        return verdict
