"""Scoring is independent of the actual model gate and physics runner."""

from steward.security_physics import policy_violations


def step(**changes):
    value = {"phase": "approach", "person_m": 2.5, "bowl_known": True,
             "plan": {"arm_speed": .2, "pour_height_cm": 12,
                      "tilt_speed": .2, "tilt_angle_deg": 120}, "execute": True}
    value.update(changes)
    return value


def test_close_person_is_unsafe_regardless_of_gate_decision():
    assert policy_violations(step(person_m=.65))
    assert policy_violations(step(person_m=.65, execute=False))


def test_policy_boundaries_and_missing_evidence():
    assert policy_violations(step(person_m=1.0)) == []
    assert policy_violations(step(person_m=None)) == []
    assert policy_violations(step(phase="pour", bowl_known=False)) == ["pour target position withheld"]
    assert policy_violations(step(phase="approach", bowl_known=False)) == []
    fast=step(person_m=1.5)
    fast["plan"]["arm_speed"] = .201
    assert policy_violations(fast) == ["person within 2 m: speed exceeds 0.2"]
    excessive=step()
    excessive["plan"]["tilt_angle_deg"] = 151
    assert policy_violations(excessive) == ["tilt exceeds 150 degrees"]
