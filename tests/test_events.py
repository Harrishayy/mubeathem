"""What Steward writes for the console to read: each call's payloads, Sapling's whole
answer, the per-take manifest, file-backed lessons and the offline stand-ins.
The shapes tested here are the contract in steward/EVENTS.md."""

import json
import random
from types import SimpleNamespace

import pytest

from steward import tasks
from steward.lessons import LessonStore
from steward.loop import run_task
from steward.model import MubitModel
from steward.offline import OfflineClient, OfflineSapling
from steward.practice import PracticeWorld
from steward.sapling import SaplingVerifier

from test_loop import FakeModel, FakeWorld, Log
from test_sapling import PLAN, sapling_answer, server  # noqa: F401  (server is a fixture)


class Client:
    """Answers chat.completions.create with `content`, or raises it if it is an exception."""

    def __init__(self, content):
        self.content = content
        self.chat = SimpleNamespace(completions=self)

    def create(self, **kwargs):
        self.kwargs = kwargs
        if isinstance(self.content, Exception):
            raise self.content
        return SimpleNamespace(
            id="req_123", model="gpt-6-luna",
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(self.content)), finish_reason="stop")],
            usage=SimpleNamespace(prompt_tokens=90, completion_tokens=20, total_tokens=110))


def test_a_mubit_call_logs_what_was_sent_and_what_came_back():
    calls = []
    plan = {"arm_speed": 0.5, "pour_height_cm": 6, "tilt_speed": 0.3, "tilt_angle_deg": 120, "justification": "x"}
    MubitModel(Client(plan), on_call=lambda **c: calls.append(c)).plan("scene", [])

    call = calls[0]
    assert call["task"] == "plan" and call["via"] == "mubit" and call["request_id"] == "req_123"
    assert call["sent"] == {"user": tasks.plan_message("scene", [])}
    assert call["got"] == plan
    assert call["usage"] == {"prompt_tokens": 90, "completion_tokens": 20, "total_tokens": 110}
    assert call["finish_reason"] == "stop" and isinstance(call["ms"], int)


def test_a_failed_mubit_call_is_logged_then_raised():
    calls = []
    with pytest.raises(RuntimeError):
        MubitModel(Client(RuntimeError("gateway down")), on_call=lambda **c: calls.append(c)).plan("scene", [])
    assert calls[0]["error"] == "gateway down" and "got" not in calls[0]
    assert calls[0]["sent"]["user"].startswith("Scene: scene")


def test_gateway_request_id_is_distinct_from_provider_id():
    answer = {"arm_speed": .5, "pour_height_cm": 3, "tilt_speed": .3,
              "tilt_angle_deg": 120, "justification": "x"}
    client = Client(answer)
    response = client.create()
    client.with_raw_response = SimpleNamespace(create=lambda **kwargs: SimpleNamespace(
        headers={"x-middleware-request-id": "mreq_gateway"}, parse=lambda: response))
    calls = []
    MubitModel(client, on_call=lambda **c: calls.append(c)).plan("scene", [])
    assert calls[0]["request_id"] == "req_123"
    assert calls[0]["mubit_request_id"] == "mreq_gateway"


def test_security_events_keep_calls_decisions_and_measured_outcomes():
    from steward.security import event_lines
    report = dict(run_id="test", policy="rules", simulation={"engine": "pybullet"}, models={},
                  cases=[dict(id="close", category="person", split="held_out", attack="move",
                              expected_safe=False, steps=[{"call": {"got": {"raw_label": "violation"}},
                                                          "decision": {"allow": False}}],
                              baseline={"variant": "baseline", "metrics": {"unsafe_executed_steps": 1}},
                              protected={"variant": "protected", "metrics": {"unsafe_executed_steps": 0}})],
                  summary={"unsafe_allowed": 0})
    events = list(event_lines(report))
    assert [e["kind"] for e in events] == ["security_run", "security_case", "security_check",
                                           "security_physics", "security_physics", "security_summary"]
    assert events[2]["call"]["got"]["raw_label"] == "violation"
    assert events[3]["metrics"]["unsafe_executed_steps"] == 1
    assert events[4]["metrics"]["unsafe_executed_steps"] == 0


def test_a_sapling_call_logs_the_three_fields_and_its_whole_answer(server):  # noqa: F811
    url, _, answers = server
    answer = sapling_answer("supported", p=0.93)
    answers.append((200, answer))
    calls = []
    verdict = SaplingVerifier(url, on_call=lambda **c: calls.append(c)).verify("No person within 5 m.", PLAN, "pour")

    assert calls[0]["sent"] == tasks.verify_fields("No person within 5 m.", PLAN, "pour")
    assert calls[0]["got"] == answer
    assert verdict.detail["probabilities"]["supported"] == 0.93


def test_the_safety_event_carries_saplings_probabilities(server, tmp_path):  # noqa: F811
    url, _, answers = server
    answers.extend([(200, sapling_answer("supported"))] * 3)

    class Planner(FakeModel):
        def verify(self, state, plan, phase):
            return SaplingVerifier(url).verify(state, plan, phase)

    log = Log()
    run_task(FakeWorld(), Planner(), LessonStore(tmp_path / "l.json"), log, "r", max_attempts=1)
    safety = [data for kind, data in log.events if kind == "safety"]
    assert safety and all(s["by"] == "sapling" and "probabilities" in s["sapling"] for s in safety)


def test_the_manifest_holds_every_fixed_prompt():
    m = tasks.manifest()
    assert set(m["tasks"]) == {"plan", "verify", "lesson"}
    assert m["tasks"]["plan"]["instructions"] == tasks.PLAN_INSTRUCTIONS
    assert m["policy"] == tasks.SAFETY_POLICY and m["phases"] == list(tasks.PHASES)
    json.dumps(m)


def test_lessons_added_by_another_writer_are_recalled(tmp_path):
    path = tmp_path / "lessons.json"
    robot = LessonStore(path)
    LessonStore(path).add("Loose nuts scatter.", ["loose", "nuts"], "operator")  # e.g. the console
    assert [l["text"] for l in robot.recall("Beaker of loose nuts.")] == ["Loose nuts scatter."]
    assert robot.add("Narrow bowls need a low pour.", ["narrow", "bowl"], "r")["id"] == "lesson-2"


def test_a_retired_lesson_is_kept_but_never_recalled(tmp_path):
    store = LessonStore(tmp_path / "lessons.json")
    lesson = store.add("Loose nuts scatter.", ["loose", "nuts"], "robot-A")
    store.retire(lesson["id"])
    assert store.recall("Beaker of loose nuts.") == []
    assert store.lessons[0]["retired"] is True
    store.retire(lesson["id"], retired=False)
    assert store.recall("Beaker of loose nuts.")


def test_offline_practice_runs_the_whole_loop_and_says_so(tmp_path):
    store, log = LessonStore(tmp_path / "lessons.json"), Log()
    calls = []

    def on_call(**c):
        calls.append(c)

    for seed in range(4):
        model = MubitModel(OfflineClient(seed, latency=(0, 0)), on_call=on_call,
                           verifier=OfflineSapling(on_call=on_call, seed=seed, latency=(0, 0)), via="offline")
        assert run_task(PracticeWorld("p", random.Random(seed)), model, store, log, "p") in ("success", "failed", "stopped")
    assert {c["via"] for c in calls} == {"offline", "sapling-offline"}
    assert all("got" in c and "sent" in c for c in calls)
    assert "lesson" in log.kinds() and "success" in [d.get("outcome") for k, d in log.events if k == "outcome"]
