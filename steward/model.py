"""The model calls: plans and lessons through Mubit's gateway; safety checks by Banyan
Sapling when a verifier is given (steward/sapling.py), else by a stand-in model through
Mubit that uses Sapling's inputs and labels."""

import json
import os
import time
from dataclasses import dataclass

from . import config, tasks


@dataclass
class Verdict:
    label: str
    status: str
    reason: str
    source: str = "stand-in"  # "sapling" when Banyan Sapling made the check

    @property
    def go(self):
        return self.label == "supported" and self.status == "decided"

    @classmethod
    def from_json(cls, raw):
        label = raw.get("label")
        status = raw.get("status")
        if label not in tasks.LABELS or status not in tasks.STATUSES:
            return cls("insufficient_information", "unsure", f"Unreadable verdict: {raw}")
        return cls(label, status, str(raw.get("reason", "")))


def mubit_client():
    from openai import OpenAI

    key = os.environ.get("MUBIT_API_KEY")
    if not key:
        raise SystemExit("Set MUBIT_API_KEY in .env or the environment.")
    return OpenAI(base_url=config.MUBIT_BASE_URL, api_key=key, max_retries=5)


class MubitModel:
    """One robot's view of the three tasks. on_call(task=, ms=, via=, request_id=) sees each
    call. With a verifier (Sapling), safety checks go to it instead of through Mubit."""

    def __init__(self, client, model=config.MODEL, on_call=None, verifier=None):
        self.client = client
        self.model = model
        self.on_call = on_call
        self.verifier = verifier

    def _call(self, task, instructions, message, schema):
        kwargs = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": message},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": task, "strict": True, "schema": schema},
            },
        }
        if config.TEMPERATURE is not None:
            kwargs["temperature"] = float(config.TEMPERATURE)
        start = time.perf_counter()
        resp = self.client.chat.completions.create(**kwargs)
        ms = round((time.perf_counter() - start) * 1000)
        if self.on_call:
            self.on_call(task=task, ms=ms, via="mubit", request_id=resp.id)
        return json.loads(resp.choices[0].message.content)

    def plan(self, state, lessons):
        raw = self._call("plan", tasks.PLAN_INSTRUCTIONS,
                         tasks.plan_message(state, lessons), tasks.PLAN_SCHEMA)
        return tasks.clamp_plan(raw)

    def verify(self, state, plan, phase):
        if self.verifier:
            return self.verifier.verify(state, plan, phase)
        raw = self._call("verify", tasks.VERIFY_INSTRUCTIONS,
                         tasks.verify_message(state, plan, phase), tasks.VERIFY_SCHEMA)
        return Verdict.from_json(raw)

    def write_lesson(self, subject, plan, reason):
        raw = self._call("lesson", tasks.LESSON_INSTRUCTIONS,
                         tasks.lesson_message(subject, plan, reason), tasks.LESSON_SCHEMA)
        return {"text": raw["text"].strip(), "applies_to": raw["applies_to"]}
