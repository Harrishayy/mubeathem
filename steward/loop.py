"""The Steward loop: recall, plan, verify, act, check, learn. It knows nothing about Isaac Sim.

A world (Isaac Sim, or the text-only practice world) supplies the scene as text
and carries out plans. Every decision is a model call; the loop fails closed, so
the robot only moves on a verdict that is supported and decided.
"""

from typing import Callable, Protocol

from .tasks import PHASES


class World(Protocol):
    def subject(self) -> str:
        """What the robot pours and where. Lessons are matched against this."""

    def describe(self) -> str:
        """The whole scene as text: the evidence the planner and verifier see."""

    def reset(self) -> None:
        """Put the scene back for a new attempt."""

    def execute(self, phase: str, plan: dict, recheck: Callable[[], bool]) -> bool:
        """Run one phase. Call recheck() whenever a person changes zone (2 m, 1 m)
        and stop if it returns False. Return False if the phase was stopped."""

    def hold(self) -> None:
        """Keep still until the scene changes (a person moves, a sensor comes back)."""

    def result(self) -> tuple:
        """(success, reason) for the attempt, from the world's own state."""


def gate(world, model, plan, phase, log, robot, max_checks=12):
    """Verify before acting. True only on supported + decided; holds through violations."""
    for _ in range(max_checks):
        try:
            verdict = model.verify(world.describe(), plan, phase)
        except Exception as error:
            log("error", robot=robot, where="verify", error=str(error))
            return False
        log("safety", robot=robot, phase=phase, label=verdict.label,
            status=verdict.status, reason=verdict.reason, by=verdict.source, calibrated=verdict.calibrated,
            **({"sapling": verdict.detail} if verdict.detail else {}))
        if verdict.go:
            return True
        if verdict.status == "unsure" or verdict.label == "inconsistent_context":
            log("escalate", robot=robot, phase=phase, reason=verdict.reason)
            return False
        log("hold", robot=robot, phase=phase, reason=verdict.reason)
        world.hold()
    log("escalate", robot=robot, phase=phase, reason="Still not safe after repeated checks.")
    return False


def run_task(world, model, store, log, robot, max_attempts=3, use_lessons=True):
    """One task, retried from the start after each failure. Returns success, failed or stopped."""
    for attempt in range(1, max_attempts + 1):
        world.reset()
        subject = world.subject()
        log("attempt", robot=robot, attempt=attempt, subject=subject)

        lessons = store.recall(subject) if use_lessons else []
        log("lessons", robot=robot, lessons=[{"id": l["id"], "text": l["text"]} for l in lessons])

        try:
            plan = model.plan(world.describe(), lessons)
        except Exception as error:
            log("error", robot=robot, where="plan", error=str(error))
            return finish(log, robot, "stopped")
        log("plan", robot=robot, attempt=attempt, plan=plan)

        for phase in PHASES:
            log("phase", robot=robot, phase=phase)
            if not gate(world, model, plan, phase, log, robot):
                return finish(log, robot, "stopped")
            if not world.execute(phase, plan, lambda: gate(world, model, plan, phase, log, robot)):
                return finish(log, robot, "stopped")

        success, reason = world.result()
        store.record_use(lessons, success)
        log("result", robot=robot, attempt=attempt, success=success, reason=reason)
        if success:
            return finish(log, robot, "success")

        try:
            written = model.write_lesson(subject, plan, reason)
        except Exception as error:
            log("error", robot=robot, where="lesson", error=str(error))
            continue
        lesson = store.add(written["text"], written["applies_to"], source=robot)
        log("lesson", robot=robot, lesson=lesson)

    return finish(log, robot, "failed")


def finish(log, robot, outcome):
    log("outcome", robot=robot, outcome=outcome)
    return outcome
