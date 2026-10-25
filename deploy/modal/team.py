"""Run Modal using only this repository's team credentials, without exposing them.

    python3 deploy/modal/team.py deploy deploy/modal/sapling.py
"""

import os
import shlex
import shutil
import sys
from pathlib import Path


def main():
    env = dict(os.environ)
    credentials = {}
    for line in (Path(__file__).resolve().parents[2] / ".env").read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() in ("MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"):
            parsed = shlex.split(value, comments=True)
            if len(parsed) == 1:
                credentials[key.strip()] = parsed[0]
    if not all(credentials.get(k) for k in ("MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET")):
        raise SystemExit("The repository .env must contain both team Modal credentials")
    env.update(credentials)
    executable = shutil.which("modal")
    if executable is None:
        raise SystemExit("Install the Modal CLI before using this helper")
    os.execve(executable, [executable, *sys.argv[1:]], env)


if __name__ == "__main__":
    main()
