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

from . import config, tasks
from .model import Verdict

# A cold Modal container loads 46 GB of weights before its first answer (about 43 s,
# runs/security/infra/validation.json). A shorter timeout would stop every robot on the
# first check after the GPU scales down.
VERIFY_TIMEOUT = 120
HEALTH_TIMEOUT = 30


def request(url, path, body=None, timeout=VERIFY_TIMEOUT):
    """GET (no body) or POST one JSON body to Sapling and return its JSON answer.
    Every caller goes through here, so SAPLING_TOKEN is sent wherever it is set."""
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if config.SAPLING_TOKEN:
        headers["Authorization"] = f"Bearer {config.SAPLING_TOKEN}"
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url.rstrip("/") + path, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def health(url):
    """Sapling's /health. It never wakes the GPU on Modal, so it says nothing about a cold start."""
    return request(url, "/health", timeout=HEALTH_TIMEOUT)


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

    def __init__(self, url, on_call=None, timeout=VERIFY_TIMEOUT):
        self.url = url.rstrip("/")
        self.on_call = on_call
        self.timeout = timeout

    def health(self):
        return health(self.url)

    def verify(self, state, plan, phase):
        """on_call sees the three fields sent and Sapling's whole answer (see steward/EVENTS.md)."""
        fields = tasks.verify_fields(state, plan, phase)
        start = time.perf_counter()
        try:
            out = request(self.url, "/verify", fields, timeout=self.timeout)
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
