import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from steward import tasks
from steward.lessons import LessonStore
from steward.loop import run_task
from steward.model import MubitModel
from steward.sapling import SaplingVerifier, verdict_from_sapling

from test_loop import FakeModel, FakeWorld, Log

PLAN = {"arm_speed": 0.5, "pour_height_cm": 3, "tilt_speed": 0.3, "tilt_angle_deg": 120, "justification": ""}


def sapling_answer(status, raw=None, prediction_set=None, p=0.97):
    raw = raw or status
    return {"status": status, "raw_label": raw, "prediction_set": prediction_set or [raw],
            "probabilities": {label: (p if label == raw else (1 - p) / 3) for label in tasks.LABELS}}


@pytest.fixture
def server():
    """A stand-in for sapling/serve.py: records each request and returns the queued answer."""
    seen, answers = [], []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            code, body = answers.pop(0)
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}", seen, answers
    httpd.shutdown()


def test_sapling_gets_policy_evidence_and_claim_as_separate_fields(server):
    url, seen, answers = server
    answers.append((200, sapling_answer("supported")))
    calls = []
    verdict = SaplingVerifier(url, on_call=lambda **c: calls.append(c)).verify("No person within 5 m.", PLAN, "pour")

    assert verdict.go and verdict.source == "sapling"
    assert seen[0] == {
        "policy": tasks.SAPLING_POLICY,
        "evidence": "Next phase: pour (phase 2 of 3; the approach is finished). No person within 5 m. "
                    "Planned settings: arm_speed 0.5, pour_height_cm 3, tilt_speed 0.3, tilt_angle_deg 120.",
        "claim": "The robot may run the pour phase now.",
    }
    assert calls[0]["task"] == "verify" and calls[0]["via"] == "sapling"


def test_stand_in_message_is_unchanged_so_its_mubit_task_stays_one_task():
    assert tasks.verify_message("scene", PLAN, "pour") == (
        f"POLICY:\n{tasks.SAFETY_POLICY}\n\nEVIDENCE:\nscene Next phase: pour. Planned settings: "
        '{"arm_speed": 0.5, "pour_height_cm": 3, "tilt_speed": 0.3, "tilt_angle_deg": 120}'
        "\n\nCLAIM: It is safe to run the next phase of this plan now.")


def test_the_robot_acts_on_saplings_top_label_and_keeps_its_calibrated_status():
    unsure_but_supported = verdict_from_sapling(sapling_answer(
        "unsure", raw="supported", prediction_set=["supported", "insufficient_information"], p=0.52))
    assert unsure_but_supported.go and unsure_but_supported.calibrated == "unsure"
    assert "supported (52%)" in unsure_but_supported.reason and "unsure" in unsure_but_supported.reason

    for top in ("violation", "insufficient_information", "inconsistent_context"):
        verdict = verdict_from_sapling(sapling_answer("unsure", raw=top, prediction_set=[top, "supported"]))
        assert not verdict.go and verdict.label == top
    assert not verdict_from_sapling({"status": "fine"}).go


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -.1, 2, True, "0.9", None])
def test_malformed_supported_probability_never_opens_the_gate(value):
    answer = sapling_answer("supported")
    answer["probabilities"]["supported"] = value
    assert not verdict_from_sapling(answer).go


def test_a_sapling_violation_holds_then_a_clear_scene_resumes(server, tmp_path):
    url, _, answers = server
    answers.extend([(200, sapling_answer("unsure", raw="violation", prediction_set=["violation", "supported"]))]
                   + [(200, sapling_answer("unsure", raw="supported", prediction_set=["supported", "violation"]))] * 3)

    class Planner(FakeModel):
        def verify(self, state, plan, phase):
            return MubitModel(None, verifier=SaplingVerifier(url)).verify(state, plan, phase)

    world, log = FakeWorld(), Log()
    store = LessonStore(tmp_path / "l.json")
    store.add("Small loose items scatter: tilt_speed 0.3 or lower.", ["loose", "nuts"], "robot-A")
    assert run_task(world, Planner(), store, log, "r") == "success"
    assert world.holds == 1
    assert [d["by"] for k, d in log.events if k == "safety"] == ["sapling"] * 4


def test_a_failed_sapling_call_stops_the_robot(server, tmp_path):
    url, _, answers = server
    answers.append((500, {"error": "out of memory"}))

    class Planner(FakeModel):
        def verify(self, state, plan, phase):
            return MubitModel(None, verifier=SaplingVerifier(url)).verify(state, plan, phase)

    world, log = FakeWorld(), Log()
    assert run_task(world, Planner(), LessonStore(tmp_path / "l.json"), log, "r") == "stopped"
    assert world.executed == []
    assert "error" in log.kinds()


def test_every_sapling_request_sends_the_token_when_one_is_set(monkeypatch):
    """The Modal deployment refuses /verify without it, so a leaked URL can't spend the GPU."""
    import io
    from steward import config, sapling

    sent = []

    def urlopen(request, timeout):
        sent.append((request.get_header("Authorization"), timeout))
        return io.BytesIO(json.dumps(sapling_answer("supported")).encode())

    monkeypatch.setattr(sapling.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(config, "SAPLING_TOKEN", "test-token")
    SaplingVerifier("http://sapling").verify("No person within 5 m.", PLAN, "pour")
    sapling.health("http://sapling")
    monkeypatch.setattr(config, "SAPLING_TOKEN", None)
    sapling.request("http://sapling", "/verify", {"policy": "p", "evidence": "e", "claim": "c"})
    # A cold Modal GPU takes about 43 s to answer, so verify waits longer than that.
    assert sent == [("Bearer test-token", sapling.VERIFY_TIMEOUT), ("Bearer test-token", sapling.HEALTH_TIMEOUT),
                    (None, sapling.VERIFY_TIMEOUT)]
    assert sapling.VERIFY_TIMEOUT > 43
