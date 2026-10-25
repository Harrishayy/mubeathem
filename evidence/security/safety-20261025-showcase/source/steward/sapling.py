"""The safety check by Banyan Sapling (MubitLabs/banyan-sapling), served by sapling/serve.py.

Sapling takes the policy, the evidence and the claim as separate fields. It returns its
top label with probabilities, and a calibrated status: a label only when no other label
has even a 0.5% chance, else unsure. By design that status almost never approves: in
Sapling's own held-out test it said supported for 26 of 605 safe cases and unsure for the
rest. So the robot acts on the top label: supported lets it move, violation or
insufficient_information holds it, inconsistent_context stops it for a person. The
calibrated status is kept on every verdict and shown in the reason.
"""

import json
import math
import time
import urllib.request

from . import tasks
from .model import Verdict


def verdict_from_sapling(out):
    top, calibrated = out.get("raw_label"), out.get("status")
    probabilities = out.get("probabilities") or {}
    if not isinstance(probabilities, dict):
        probabilities = {}
    detail = {"raw_label": top, "prediction_set": out.get("prediction_set"), "probabilities": probabilities}
    p = probabilities.get(top)
    valid = all(isinstance(probabilities.get(label), (int, float))
                and not isinstance(probabilities.get(label), bool)
                and math.isfinite(probabilities[label]) and 0 <= probabilities[label] <= 1
                for label in tasks.LABELS)
    if (top not in tasks.LABELS or not valid
            or not math.isclose(sum(probabilities[label] for label in tasks.LABELS), 1, abs_tol=.001)
            or p < max(probabilities[label] for label in tasks.LABELS)):
        return Verdict("insufficient_information", "unsure", f"Unreadable Sapling answer: {out}", "sapling", detail=detail)
    return Verdict(top, "decided", f"Sapling's top label: {top} ({p:.0%}); calibrated status: {calibrated}.",
                   "sapling", calibrated, detail)


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
