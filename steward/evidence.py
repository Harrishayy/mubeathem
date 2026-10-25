"""Copy real recordings into evidence/, the folder committed with the repo, so anyone who
clones it can open the console on real results. The console reads evidence/ whenever
runs/ holds no take or safety report.

    python3 -m steward.evidence --take robot-A-20261024-153012 --security safety-20261025-showcase
    python3 -m steward.evidence --check     # scan evidence/ and every file git would commit

Text files are redacted on the way in: endpoint URLs (Modal, tunnels, SAPLING_URL) and this
machine's absolute paths. The export stops if a file holds a credential from .env or
anything shaped like one, and it refuses offline or fixture takes: evidence is real or
absent. The originals in runs/ are untouched; resume or reproduce a run from those.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from . import config

EVIDENCE_DIR = config.ROOT / "evidence"
TEXT = {".json", ".jsonl", ".log", ".txt", ".md", ".py", ".csv", ".html", ".yaml", ".yml", ".sh", ".ts", ".tsx", ".js"}
REDACTED = "<redacted endpoint>"
# Recordings and the files bound to them stay on the machine that made them. The report
# keeps each recording's measured metrics, so the console still shows every result.
LOCAL_ONLY = ("*.mp4", "*.physics.json", "*.render.json", "*.presentation.json")
# Hosted endpoints whose URL alone would let someone spend our credits.
ENDPOINT = re.compile(r"https?://[A-Za-z0-9.-]*(?:modal\.run|ngrok(?:-free)?\.(?:app|io|dev)|trycloudflare\.com)[^\s\"'<>)\]]*")
SHAPES = [
    re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{20,}"),
    re.compile(r"\b(?:sk|ak|as|mk)-[A-Za-z0-9_-]{20,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET)\s*[=:]\s*['\"]?[A-Za-z0-9._~+/-]{16,}"),
]


def credentials():
    """Values of every *KEY, *TOKEN, *SECRET and *PASSWORD setting in the environment and .env
    (steward/config.py has loaded .env into the environment). Matched, never printed."""
    names = re.compile(r"(?:KEY|TOKEN|SECRET|PASSWORD)$")
    return {v for k, v in os.environ.items() if names.search(k) and len(v) >= 8}


def leaks(text, secrets=None):
    """What in this text could spend our credits: a reason per finding, never the value."""
    found = []
    if ENDPOINT.search(text):
        found.append("hosted endpoint URL")
    if config.SAPLING_URL and config.SAPLING_URL.startswith("https://") and config.SAPLING_URL.rstrip("/") in text:
        found.append("SAPLING_URL")
    if any(p.search(text) for p in SHAPES):
        found.append("credential-shaped string")
    if any(s in text for s in (credentials() if secrets is None else secrets)):
        found.append("a credential from .env")
    return found


def redact(text):
    """Endpoint URLs out, and this machine's paths made relative to the repo."""
    if config.SAPLING_URL and config.SAPLING_URL.startswith("https://"):
        text = text.replace(config.SAPLING_URL.rstrip("/"), REDACTED)
    text = ENDPOINT.sub(REDACTED, text)
    return text.replace(f"{config.ROOT}/", "").replace(str(config.ROOT), ".").replace(str(Path.home()), "~")


def copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix in TEXT:
        text = redact(source.read_text(errors="replace"))
        if found := leaks(text):
            raise SystemExit(f"Refusing {source}: {', '.join(found)} remains after redaction.")
        destination.write_text(text)
    else:
        data = source.read_bytes()
        if any(s.encode() in data for s in credentials()):
            raise SystemExit(f"Refusing {source}: it contains a credential from .env.")
        shutil.copyfile(source, destination)


def is_real_take(path):
    events = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    take = next((e for e in events if e.get("kind") == "take"), {})
    if take.get("offline") or take.get("fixture") or take.get("verifier") == "sapling-offline":
        return False
    return not any(e.get("kind") == "call" and e.get("via") in ("offline", "sapling-offline") for e in events)


def export_take(take, runs=config.RUNS_DIR, out=EVIDENCE_DIR):
    log = runs / "takes" / f"{take}.jsonl"
    if not log.exists():
        raise SystemExit(f"No take {log}.")
    if not is_real_take(log):
        raise SystemExit(f"{take} is an offline or fixture take; evidence holds real takes only.")
    files = [p for p in (runs / "takes").glob(f"{take}.*") if not any(p.match(pattern) for pattern in LOCAL_ONLY)]
    for source in files:
        copy(source, out / source.relative_to(runs))
    return files


def export_security(run, runs=config.RUNS_DIR, out=EVIDENCE_DIR):
    directory = runs / "security" / run
    report = directory / "report.json"
    if not report.exists():
        raise SystemExit(f"{directory} has no report.json, so it isn't a completed run.")
    data = json.loads(report.read_text())
    if data.get("mode") != "live" or data.get("offline") or data.get("fixture"):
        raise SystemExit(f"{run} is not a live run; evidence holds real runs only.")
    files = [p for p in directory.rglob("*") if p.is_file() and not p.name.endswith(".tmp")
             and not any(p.match(pattern) for pattern in LOCAL_ONLY)]
    for source in files:
        copy(source, out / source.relative_to(runs))
    return files


LOCAL_DIRS = {".git", "node_modules", "runs", ".next", "__pycache__", ".pytest_cache"}


def committed_files():
    """Every file git would commit: tracked, plus untracked files that aren't ignored. Without
    git (a downloaded archive), every file outside the folders .gitignore keeps local."""
    try:
        out = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                             cwd=config.ROOT, capture_output=True, check=True).stdout
        return [config.ROOT / p for p in out.decode().split("\0") if p]
    except (OSError, subprocess.CalledProcessError):
        return [p for p in config.ROOT.rglob("*") if p.is_file() and p.name != ".env"
                and not LOCAL_DIRS & set(p.relative_to(config.ROOT).parts)
                and not any(p.match(pattern) for pattern in LOCAL_ONLY)]


def check(paths):
    """{path: reasons} for every file that could spend our credits."""
    secrets, problems = credentials(), {}
    for path in paths:
        if not path.is_file() or path.name == ".env":
            continue
        if path.suffix in TEXT:
            found = leaks(path.read_text(errors="replace"), secrets)
        else:
            data = path.read_bytes()
            found = ["a credential from .env"] if any(s.encode() in data for s in secrets) else []
        if found:
            problems[path] = found
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--take", nargs="*", default=[], help="Isaac or practice takes in runs/takes/.")
    parser.add_argument("--security", nargs="*", default=[], help="Completed runs in runs/security/.")
    parser.add_argument("--check", action="store_true", help="Only scan evidence/ and the files git would commit.")
    args = parser.parse_args()
    if not args.check:
        if not args.take and not args.security:
            parser.error("name at least one --take or --security run, or pass --check")
        for take in args.take:
            print(f"take {take}: {len(export_take(take))} files")
        for run in args.security:
            print(f"security {run}: {len(export_security(run))} files")
    problems = check(set(committed_files()) | set(EVIDENCE_DIR.rglob("*")))
    for path, found in sorted(problems.items()):
        print(f"LEAK {path.relative_to(config.ROOT)}: {', '.join(found)}", file=sys.stderr)
    if problems:
        raise SystemExit(1)
    print("No endpoint URLs or credentials in evidence/ or in any file git would commit.")


if __name__ == "__main__":
    main()
