"""The event log the panel reads. Each take gets its own file, so takes can be compared later."""

import json
import threading
import time
from pathlib import Path


class EventLog:
    def __init__(self, runs_dir, take=None):
        self.take = take or time.strftime("%Y%m%d-%H%M%S")
        runs_dir = Path(runs_dir)
        (runs_dir / "takes").mkdir(parents=True, exist_ok=True)
        self.files = [runs_dir / "latest.jsonl", runs_dir / "takes" / f"{self.take}.jsonl"]
        self.files[0].write_text("")
        self.lock = threading.Lock()

    def __call__(self, kind, **data):
        line = json.dumps({"t": round(time.time(), 3), "take": self.take, "kind": kind, **data})
        with self.lock:
            for path in self.files:
                with path.open("a") as f:
                    f.write(line + "\n")
