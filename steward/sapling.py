"""The safety check by Banyan Sapling (MubitLabs/banyan-sapling), served by sapling/serve.py.

Sapling takes the policy, the evidence and the claim as separate fields and returns a
calibrated status: one of the four labels, or unsure when its prediction set holds more
than one. It writes no reason, so the reason shown is its answer and probability.
"""

import json
import time
import urllib.request

from . import tasks
from .model import Verdict


def verdict_from_sapling(out):
    status, raw = out.get("status"), out.get("raw_label")
    probabilities = out.get("probabilities") or {}
    detail = {"raw_label": raw, "prediction_set": out.get("prediction_set"), "probabilities": probabilities}
    if status in tasks.LABELS:
        return Verdict(status, "decided", f"Sapling: {status} ({probabilities.get(status, 0):.0%}).", "sapling", detail)
    if status == "unsure" and raw in tasks.LABELS:
        options = " or ".join(out.get("prediction_set") or [raw])
        return Verdict(raw, "unsure", f"Sapling is unsure: {options}.", "sapling", detail)
    return Verdict("insufficient_information", "unsure", f"Unreadable Sapling answer: {out}", "sapling", detail)


class SaplingVerifier:
    """verify() posts one check; a failed call raises, and the loop stops the robot."""

    def __init__(self, url, on_call=None, timeout=30):
        self.url = url.rstrip("/")
        self.on_call = on_call
        self.timeout = timeout

    def health(self):
        with urllib.request.urlopen(f"{self.url}/health", timeout=self.timeout) as resp:
            return json.load(resp)

    def verify(self, state, plan, phase):
        """on_call sees the three fields sent and Sapling's whole answer (see steward/EVENTS.md)."""
        fields = tasks.verify_fields(state, plan, phase)
        request = urllib.request.Request(f"{self.url}/verify", data=json.dumps(fields).encode(),
                                         headers={"Content-Type": "application/json"})
        start = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as resp:
                out = json.load(resp)
        except Exception as error:
            self._report(ms=_ms(start), sent=fields, error=str(error))
            raise
        self._report(ms=_ms(start), sent=fields, got=out)
        return verdict_from_sapling(out)

    def _report(self, **call):
        if self.on_call:
            self.on_call(task="verify", via="sapling", **call)


def _ms(start):
    return round((time.perf_counter() - start) * 1000)
