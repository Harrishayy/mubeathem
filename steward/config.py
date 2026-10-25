import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env(path=ROOT / ".env"):
    """Read KEY=VALUE lines from .env without overriding the real environment."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


load_env()

MUBIT_BASE_URL = os.environ.get("MUBIT_BASE_URL", "https://api.mubit.ai/openai/v1")
MODEL = os.environ.get("STEWARD_MODEL", "gpt-6-luna")
TEMPERATURE = os.environ.get("STEWARD_TEMPERATURE")
RUNS_DIR = Path(os.environ.get("STEWARD_RUNS_DIR", ROOT / "runs"))
# Banyan Sapling, served by sapling/serve.py or deploy/modal/sapling.py. Unset: safety checks
# use the stand-in through Mubit.
SAPLING_URL = os.environ.get("SAPLING_URL")
# Sent as a bearer token on every Sapling request when set. The Modal deployment refuses
# /verify without it, so a leaked URL can't spend the GPU; sapling/serve.py checks it if given one.
SAPLING_TOKEN = os.environ.get("SAPLING_TOKEN")
