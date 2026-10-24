"""
Cue server on Modal: one always-warm container running the bundled Node server.

    pnpm --filter @cue/server bundle        # → apps/server/dist/cue-server.mjs
    modal deploy deploy/modal/app.py        # → https://<workspace>--corgi-cue-live-serve.eu-west.modal.run

Why one container: the live pipeline keeps per-call state in memory (the run in flight, interim
endpointing, the call's playbook draw) and the store is SQLite. `min_containers=1` keeps it warm so
the first turn of a call never waits on a cold start.

The database lives on local disk for speed and is copied to a Modal Volume every 30 s (SQLite's
online backup, so the copy is consistent while the server writes) and when the container stops.
A new container starts from the last copy.

Keys come from the Modal secrets `corgi-cue-keys` (MUBIT_API_KEY, DEEPGRAM_API_KEY and
any other env var in .env.example) and `corgi-cue-token` (CUE_API_TOKEN, which the extension sends).
Everything else is set below and can be overridden by a secret.
"""

import os
import pathlib
import shutil
import sqlite3
import subprocess
import threading
import time

import modal

DATA = "/data"
LIVE_DB = "/tmp/cue.db"
SAVED_DB = f"{DATA}/cue.db"
PORT = 8787

# Live-path defaults for the hosted server; a key of the same name in the secret wins.
DEFAULTS = {
    "CUE_PIPELINE": "live",
    "CUE_AUTO_ACTIVATE": "1",
    "CUE_LIVE_MODEL": "gpt-4.1-mini",
    "CUE_LIVE_BUDGET_MS": "4000",
    "CUE_PREDICT": "3",
    "CUE_PREDICT_MATCH": "0.5",
    "CUE_SPECULATE_WORDS": "4",
    "CUE_ENDPOINT_PAUSE_MS": "150",
    "CUE_ALLOWED_ORIGINS": "chrome-extension://*,http://localhost:5173",
    "CUE_MUBIT_CONCURRENCY": "8",
    "DEEPGRAM_HOST": "api.eu.deepgram.com",
}

app = modal.App("corgi-cue")
volume = modal.Volume.from_name("corgi-cue-data", create_if_missing=True)
image = modal.Image.from_registry("node:24-slim", add_python="3.11")
if modal.is_local():
    # Only on the machine that deploys: inside the container this file sits at /root/app.py.
    BUNDLE = pathlib.Path(__file__).resolve().parents[2] / "apps" / "server" / "dist" / "cue-server.mjs"
    image = image.add_local_file(BUNDLE, "/app/cue-server.mjs")


def _backup() -> None:
    """Consistent copy of the live database onto the volume, then commit it."""
    if not os.path.exists(LIVE_DB):
        return
    tmp = SAVED_DB + ".tmp"
    src = sqlite3.connect(LIVE_DB)
    dst = sqlite3.connect(tmp)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    os.replace(tmp, SAVED_DB)
    volume.commit()


def _backup_loop() -> None:
    while True:
        time.sleep(30)
        try:
            _backup()
        except Exception as e:  # a failed copy must never take the server down
            print(f"[cue] backup failed: {e}", flush=True)


@app.cls(
    image=image,
    secrets=[modal.Secret.from_name("corgi-cue-keys"), modal.Secret.from_name("corgi-cue-token")],
    volumes={DATA: volume},
    # Mubit's gateway and Deepgram's EU endpoint are ~15-30 ms from eu-west and 75-105 ms from
    # us-east (measured from Modal), and the reps are in the UK: the live path lives here.
    region="eu-west",
    # Requests enter Modal in Dublin too (fixed when a function is first deployed: to change it, rename the class).
    routing_region="eu-west",
    # The Node server is I/O-bound: half a core keeps the always-on cost to roughly $20-35 a month.
    cpu=0.5,
    memory=512,
    min_containers=1,
    max_containers=1,
    scaledown_window=1200,
    timeout=24 * 3600,
)
@modal.concurrent(max_inputs=500)
class Live:
    @modal.enter()
    def start(self) -> None:
        if os.path.exists(SAVED_DB) and not os.path.exists(LIVE_DB):
            shutil.copy(SAVED_DB, LIVE_DB)
        env = {**DEFAULTS, **os.environ, "CUE_DB_PATH": LIVE_DB, "CUE_PORT": str(PORT)}
        self.proc = subprocess.Popen(["node", "--no-warnings", "/app/cue-server.mjs"], env=env)
        threading.Thread(target=_backup_loop, daemon=True).start()

    @modal.web_server(PORT, startup_timeout=60)
    def serve(self) -> None:
        pass

    @modal.exit()
    def stop(self) -> None:
        # Let the server flush its trace buffer and close the database, then keep the last copy.
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        _backup()


@app.function(image=image, volumes={DATA: volume})
def stats() -> dict:
    """`modal run deploy/modal/app.py::stats` — how much the saved database holds."""
    if not os.path.exists(SAVED_DB):
        return {"saved": False}
    db = sqlite3.connect(SAVED_DB)
    try:
        tables = [r[0] for r in db.execute("select name from sqlite_master where type='table'")]
        return {"saved": True, "bytes": os.path.getsize(SAVED_DB), "tables": {t: db.execute(f'select count(*) from "{t}"').fetchone()[0] for t in tables}}
    finally:
        db.close()
