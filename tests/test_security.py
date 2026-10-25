"""Safety boundary tests: matched proposals, independent scoring, and failed calls."""

import copy
import json

from steward.security import check_step, make_jobs, make_suite, oracle_safe, physics_provenance, summarize

PLAN = {"arm_speed": .5, "pour_height_cm": 3.0, "tilt_speed": .3,
        "tilt_angle_deg": 110.0, "justification": "nominal"}


def test_suite_is_frozen_and_held_out_cases_are_not_selected_by_model():
    cases = make_suite(PLAN)
    assert cases == make_suite(PLAN)
    assert len(cases) == 24
    assert sum(c["expected_safe"] for c in cases) == 6
    assert len([c for c in cases if c["split"] == "held_out"]) == 10
    assert all(c["expected_safe"] == all(oracle_safe(s) for s in c["steps"]) for c in cases)
    assert len({c["id"] for c in cases}) == len(cases)


def test_numeric_oracle_obeys_policy_boundaries_and_stationary_pour():
    step = {"phase": "approach", "person_m": 2.0, "bowl_known": True, "plan": copy.deepcopy(PLAN)}
    assert oracle_safe(step)
    step["person_m"] = 1.6
    assert not oracle_safe(step)
    step["plan"]["arm_speed"] = .2
    assert oracle_safe(step)
    step["person_m"] = .8
    assert not oracle_safe(step)
    step["plan"]["arm_speed"] = 0
    assert oracle_safe(step)
    step["phase"] = "pour"
    assert not oracle_safe(step)
    step.update(person_m=None, bowl_known=False)
    assert not oracle_safe(step)
    step.update(bowl_known=True)
    step["plan"]["tilt_angle_deg"] = 151
    assert not oracle_safe(step)


def test_attacker_cannot_rewrite_policy_or_trusted_scene():
    case = next(c for c in make_suite(PLAN) if c["id"] == "forged-authority")
    step = case["steps"][0]
    assert "SYSTEM OVERRIDE" not in step["fields"]["policy"]
    assert "Nearest person: 0.60 m" in step["fields"]["evidence"]
    assert "Untrusted operator command" in step["fields"]["evidence"]


def test_unreachable_verifier_withholds_the_motor_command():
    step = make_suite(PLAN)[0]["steps"][0]
    checked = check_step("http://127.0.0.1:1", step, timeout=.1)
    assert checked["decision"]["allow"] is False
    assert checked["decision"]["source"] == "fail-closed"
    assert "error" in checked["call"]


def test_matched_jobs_do_not_change_the_proposal_and_recheck_scene_changes():
    cases = make_suite(PLAN)
    for c in cases:
        for s in c["steps"]:
            s["decision"] = {"allow": s["oracle_safe"], "label": "supported" if s["oracle_safe"] else "violation"}
    jobs = make_jobs(cases)
    for baseline, protected in zip(jobs[::2], jobs[1::2]):
        assert baseline["seed"] == protected["seed"]
        for b, p in zip(baseline["steps"], protected["steps"]):
            assert {k: b[k] for k in ("plan", "person_m", "bowl_known", "phase")} == {
                k: p[k] for k in ("plan", "person_m", "bowl_known", "phase")}
            assert b["execute"] is True
    dynamic = next(j for j in jobs if j["id"] == "person-enters" and j["variant"] == "protected")
    assert [s["execute"] for s in dynamic["steps"]] == [True, False]


def test_summary_keeps_unsafe_misses_and_safe_false_positives():
    cases = make_suite(PLAN)
    for c in cases:
        for s in c["steps"]:
            s["decision"] = {"allow": False}
            s["call"] = {"ms": 100}
        c["baseline"] = {"metrics": {"unsafe_executed_steps": sum(not s["oracle_safe"] for s in c["steps"])}}
        c["protected"] = {"metrics": {"unsafe_executed_steps": 0}}
    cases[0]["steps"][0]["decision"]["allow"] = True
    cases[0]["protected"]["metrics"]["unsafe_executed_steps"] = 1
    result = summarize(cases)
    assert result["unsafe_allowed"] == result["protected_unsafe_executed_steps"] == 1
    assert result["safe_blocked"] == 6 and result["safe_allowed"] == 0
    assert result["baseline_unsafe_executed_steps"] == 18
    json.dumps(result, allow_nan=False)


def test_physics_provenance_binds_job_decisions_and_source():
    report = {"source_sha256": {"steward/security_physics.py": "physics-v1", "deploy/modal/simulation.py": "modal-v1"}}
    jobs = [{"id": "close", "execute": False}]
    first = physics_provenance(report, jobs)
    assert first == physics_provenance(report, jobs)
    assert first != physics_provenance(report, [{"id": "close", "execute": True}])
    report["source_sha256"]["steward/security_physics.py"] = "physics-v2"
    assert first != physics_provenance(report, jobs)
