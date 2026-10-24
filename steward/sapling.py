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
import time
import urllib.request

from . import tasks
from .model import Verdict


def verdict_from_sapling(out):
    top, calibrated = out.get("raw_label"), out.get("status")
    p = (out.get("probabilities") or {}).get(top)
    if top not in tasks.LABELS or p is None:
        return Verdict("insufficient_information", "unsure", f"Unreadable Sapling answer: {out}", "sapling")
    return Verdict(top, "decided", f"Sapling's top label: {top} ({p:.0%}); calibrated status: {calibrated}.",
                   "sapling", calibrated)


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
        body = json.dumps(tasks.verify_fields(state, plan, phase)).encode()
        request = urllib.request.Request(f"{self.url}/verify", data=body,
                                         headers={"Content-Type": "application/json"})
        start = time.perf_counter()
        with urllib.request.urlopen(request, timeout=self.timeout) as resp:
            out = json.load(resp)
        ms = round((time.perf_counter() - start) * 1000)
        if self.on_call:
            self.on_call(task="verify", ms=ms, via="sapling")
        return verdict_from_sapling(out)
