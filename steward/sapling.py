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
    if status in tasks.LABELS:
        return Verdict(status, "decided", f"Sapling: {status} ({probabilities.get(status, 0):.0%}).", "sapling")
    if status == "unsure" and raw in tasks.LABELS:
        options = " or ".join(out.get("prediction_set") or [raw])
        return Verdict(raw, "unsure", f"Sapling is unsure: {options}.", "sapling")
    return Verdict("insufficient_information", "unsure", f"Unreadable Sapling answer: {out}", "sapling")


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
