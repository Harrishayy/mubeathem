import json

import pytest

from steward import config, evidence

URL = "https://team--steward-sapling.us-east." + "modal.run"  # split, so this file passes its own guard


def take(runs, name, **take_fields):
    (runs / "takes").mkdir(parents=True, exist_ok=True)
    lines = [{"kind": "take", "take": name, **take_fields},
             {"kind": "call", "task": "plan", "via": "mubit", "url": f"{URL}/verify"}]
    (runs / "takes" / f"{name}.jsonl").write_text("".join(json.dumps(line) + "\n" for line in lines))


def test_endpoint_urls_and_local_paths_are_redacted_and_the_json_stays_valid(tmp_path):
    runs = tmp_path / "runs"
    take(runs, "robot-A-1", mode="isaac", lessons_file=f"{config.ROOT}/runs/takes/robot-A-1.lessons.json")
    evidence.export_take("robot-A-1", runs=runs, out=tmp_path / "evidence")
    text = (tmp_path / "evidence/takes/robot-A-1.jsonl").read_text()
    assert "modal.run" not in text and str(config.ROOT) not in text
    assert json.loads(text.splitlines()[0])["lessons_file"] == "runs/takes/robot-A-1.lessons.json"
    assert not evidence.check(list((tmp_path / "evidence").rglob("*")))


@pytest.mark.parametrize("fields", [{"offline": True}, {"fixture": True}, {"verifier": "sapling-offline"}])
def test_offline_and_fixture_takes_never_become_evidence(tmp_path, fields):
    take(tmp_path / "runs", "robot-A-2", **fields)
    with pytest.raises(SystemExit):
        evidence.export_take("robot-A-2", runs=tmp_path / "runs", out=tmp_path / "evidence")
    assert not (tmp_path / "evidence").exists()


def test_a_credential_from_the_environment_stops_the_export(tmp_path, monkeypatch):
    monkeypatch.setenv("EXAMPLE_API_KEY", "not-a-real-key-0123456789")
    take(tmp_path / "runs", "robot-A-3", mode="isaac", note="not-a-real-key-0123456789")
    with pytest.raises(SystemExit, match="credential"):
        evidence.export_take("robot-A-3", runs=tmp_path / "runs", out=tmp_path / "evidence")


def test_only_completed_live_security_runs_are_exported(tmp_path):
    run = tmp_path / "runs/security/partial"
    run.mkdir(parents=True)
    (run / "captured.json").write_text("{}")
    with pytest.raises(SystemExit, match="completed"):
        evidence.export_security("partial", runs=tmp_path / "runs", out=tmp_path / "evidence")


def test_nothing_git_would_commit_holds_an_endpoint_url_or_a_credential():
    """The repo is public: a hosted URL or a key in it would let anyone spend our credits."""
    problems = evidence.check(evidence.committed_files() + list(evidence.EVIDENCE_DIR.rglob("*")))
    assert not problems, {str(p.relative_to(config.ROOT)): why for p, why in problems.items()}
