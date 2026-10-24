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
    assert seen[0]["policy"] == tasks.SAFETY_POLICY
    assert seen[0]["claim"] == tasks.SAFETY_CLAIM
    assert seen[0]["evidence"].startswith("No person within 5 m. Next phase: pour.")
    assert calls[0]["task"] == "verify" and calls[0]["via"] == "sapling"


def test_stand_in_message_is_unchanged_so_its_mubit_task_stays_one_task():
    assert tasks.verify_message("scene", PLAN, "pour") == (
        f"POLICY:\n{tasks.SAFETY_POLICY}\n\nEVIDENCE:\nscene Next phase: pour. Planned settings: "
        '{"arm_speed": 0.5, "pour_height_cm": 3, "tilt_speed": 0.3, "tilt_angle_deg": 120}'
        "\n\nCLAIM: It is safe to run the next phase of this plan now.")


def test_only_a_decided_supported_answer_lets_the_robot_move():
    assert verdict_from_sapling(sapling_answer("supported")).go
    violation = verdict_from_sapling(sapling_answer("violation"))
    assert not violation.go and violation.label == "violation" and violation.status == "decided"
    unsure = verdict_from_sapling(sapling_answer("unsure", raw="supported",
                                                 prediction_set=["supported", "insufficient_information"]))
    assert not unsure.go and unsure.status == "unsure" and unsure.label == "supported"
    assert not verdict_from_sapling({"status": "fine"}).go


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
