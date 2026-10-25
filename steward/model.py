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
    calibrated: str = None  # Sapling's calibrated status, kept for the record (see steward/sapling.py)
    detail: dict | None = None  # Sapling's raw_label, prediction_set and probabilities

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
    """One robot's view of the three tasks. on_call(task=, ms=, via=, ...) sees each call,
    with what was sent and what came back (see steward/EVENTS.md). With a verifier
    (Sapling), safety checks go to it instead of through Mubit."""

    via = "mubit"

    def __init__(self, client, model=config.MODEL, on_call=None, verifier=None, via=None):
        self.client = client
        self.model = model
        self.on_call = on_call
        self.verifier = verifier
        if via:
            self.via = via

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
        # The instructions and schema are fixed per task and logged once per take (the
        # take event's `steward` manifest), so each call logs only the user message.
        sent = {"user": message}
        start = time.perf_counter()
        middleware_id = None
        try:
            completions = self.client.chat.completions
            if hasattr(completions, "with_raw_response"):
                raw_response = completions.with_raw_response.create(**kwargs)
                middleware_id = raw_response.headers.get("x-middleware-request-id")
                resp = raw_response.parse()
            else:
                resp = completions.create(**kwargs)
            content = resp.choices[0].message.content
            got = json.loads(content)
        except Exception as error:
            self._report(task=task, ms=_ms(start), model=self.model, sent=sent, error=str(error))
            raise
        choice = resp.choices[0]
        self._report(task=task, ms=_ms(start), request_id=getattr(resp, "id", None),
                     mubit_request_id=middleware_id,
                     model=getattr(resp, "model", None) or self.model, sent=sent, got=got,
                     usage=_usage(resp), finish_reason=getattr(choice, "finish_reason", None))
        return got

    def _report(self, **call):
        if self.on_call:
            self.on_call(via=self.via, **call)

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


def _ms(start):
    return round((time.perf_counter() - start) * 1000)


def _usage(resp):
    usage = getattr(resp, "usage", None)
    if usage is None:
        return None
    keys = ("prompt_tokens", "completion_tokens", "total_tokens")
    return {k: getattr(usage, k, None) for k in keys if getattr(usage, k, None) is not None} or None
