from steward.lessons import LessonStore
from steward.loop import run_task
from steward.model import Verdict


class Log:
    def __init__(self):
        self.events = []

    def __call__(self, kind, **data):
        self.events.append((kind, data))

    def kinds(self):
        return [kind for kind, _ in self.events]


class FakeModel:
    """Pours fast with no lessons, slowly once a lesson is in the message."""

    def __init__(self, verdicts=None):
        self.verdicts = list(verdicts or [])
        self.plans_seen = []

    def plan(self, state, lessons):
        self.plans_seen.append([l["text"] for l in lessons])
        speed = 0.3 if lessons else 0.8
        return {"arm_speed": 0.5, "pour_height_cm": 6, "tilt_speed": speed,
                "tilt_angle_deg": 120, "justification": ""}

    def verify(self, state, plan, phase):
        if self.verdicts:
            verdict = self.verdicts.pop(0)
            if isinstance(verdict, Exception):
                raise verdict
            return verdict
        return Verdict("supported", "decided", "ok")

    def write_lesson(self, subject, plan, reason):
        return {"text": "Small loose items scatter: tilt_speed 0.3 or lower.",
                "applies_to": ["loose", "nuts"]}


class FakeWorld:
    def __init__(self):
        self.executed = []
        self.resets = 0
        self.holds = 0
        self.plan = None

    def subject(self):
        return "Beaker of small loose hex nuts. Pouring into a wide bowl."

    def describe(self):
        return "scene"

    def reset(self):
        self.resets += 1

    def execute(self, phase, plan, recheck):
        self.executed.append(phase)
        self.plan = plan
        return True

    def hold(self):
        self.holds += 1

    def result(self):
        if self.plan["tilt_speed"] > 0.5:
            return False, "40% of the contents landed outside the bowl."
        return True, "98% landed in the bowl."


def test_failure_writes_a_lesson_and_the_retry_restarts_and_reads_it(tmp_path):
    world, model, log = FakeWorld(), FakeModel(), Log()
    store = LessonStore(tmp_path / "lessons.json")

    assert run_task(world, model, store, log, "robot-A") == "success"
    assert world.resets == 2
    assert world.executed == ["approach", "pour", "return"] * 2
    assert model.plans_seen == [[], ["Small loose items scatter: tilt_speed 0.3 or lower."]]
    assert store.lessons[0]["uses"] == 1 and store.lessons[0]["successes"] == 1


def test_a_second_robot_succeeds_first_time_from_the_shared_lesson(tmp_path):
    store = LessonStore(tmp_path / "lessons.json")
    run_task(FakeWorld(), FakeModel(), store, Log(), "robot-A")

    world, log = FakeWorld(), Log()
    assert run_task(world, FakeModel(), LessonStore(tmp_path / "lessons.json"), log, "robot-B") == "success"
    assert world.resets == 1
    assert "lesson" not in log.kinds()


def test_lessons_off_gives_the_planner_nothing(tmp_path):
    store = LessonStore(tmp_path / "lessons.json")
    run_task(FakeWorld(), FakeModel(), store, Log(), "robot-A")

    model = FakeModel()
    run_task(FakeWorld(), model, store, Log(), "control", max_attempts=1, use_lessons=False)
    assert model.plans_seen == [[]]


def test_violation_holds_then_resumes(tmp_path):
    world = FakeWorld()
    model = FakeModel([Verdict("violation", "decided", "person at 0.8 m")])
    store = LessonStore(tmp_path / "lessons.json")
    store.add("Small loose items scatter: tilt_speed 0.3 or lower.", ["loose", "nuts"], "robot-A")

    assert run_task(world, model, store, Log(), "robot-A") == "success"
    assert world.holds == 1


def test_never_acts_without_a_decided_supported_verdict(tmp_path):
    for verdict in [Verdict("inconsistent_context", "decided", "x"),
                    Verdict("supported", "unsure", "x"),
                    RuntimeError("gateway down")]:
        world, log = FakeWorld(), Log()
        outcome = run_task(world, FakeModel([verdict]), LessonStore(tmp_path / "l.json"), log, "r")
        assert outcome == "stopped"
        assert world.executed == []


def test_unreadable_verdict_is_treated_as_unsure():
    verdict = Verdict.from_json({"label": "fine", "status": "decided"})
    assert not verdict.go and verdict.status == "unsure"


def test_recall_needs_two_matching_property_words(tmp_path):
    store = LessonStore(tmp_path / "lessons.json")
    store.add("Loose nuts scatter.", ["loose", "nuts", "small"], "robot-A")
    assert store.recall("Beaker of small loose hex nuts.")
    assert not store.recall("Beaker of small wooden blocks.")


def test_practice_world_runs_the_whole_loop(tmp_path):
    import random

    from steward.practice import PracticeWorld

    store = LessonStore(tmp_path / "lessons.json")
    for seed in range(30):
        log = Log()
        outcome = run_task(PracticeWorld("p", random.Random(seed)), FakeModel(), store, log, "p")
        assert outcome in ("success", "failed", "stopped")
        assert log.kinds()[-1] == "outcome"
