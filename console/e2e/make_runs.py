"""Build a fixture runs dir for testing the console end to end, with no keys and no DGX.

    python3 console/e2e/make_runs.py <runs dir>
    STEWARD_RUNS_DIR=<runs dir> pnpm --dir console start

It runs Steward's real loop (steward/loop.py) and EventLog, so every file has exactly the
shape real runs have:
  - an offline practice take (python -m steward.practice --offline), and
  - an Isaac-style take with a synthetic video, head camera and frame times, made by a
    stand-in world, then put through video/prepare.py like a pulled take.
Model calls go to the offline stand-ins (steward/offline.py). Every take says offline and
fixture, and the video is labelled FIXTURE in every frame, so none of it can pass for a
real run.
"""

import json
import math
import os
import random
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageDraw  # noqa: E402

from steward import tasks  # noqa: E402
from steward.events import EventLog  # noqa: E402
from steward.lessons import LessonStore  # noqa: E402
from steward.loop import run_task  # noqa: E402
from steward.model import MubitModel  # noqa: E402
from steward.offline import OfflineClient, OfflineSapling  # noqa: E402

FPS = 50
W, H = 960, 540
PW, PH = 480, 300
FRAMES = {"approach": 60, "return": 50}


class FixtureWorld:
    """Stands in for isaac/pour_world.py: the same scene text and results, and a frame
    recorded (with its wall-clock time) for every simulated step."""

    def __init__(self, seed):
        self.rng = random.Random(seed)
        self.frames = []          # (time, state) per frame
        self.plan = None
        self.attempt = 0

    def subject(self):
        return "Beaker of steel hex nuts, 3 pieces. Pouring into a steel sorting bowl, 18 cm across."

    def describe(self):
        return ("Robot robot-A, a GR-1 humanoid at a lab bench. Task: pour the beaker of steel hex nuts into the "
                "steel sorting bowl, 18 cm across. Bowl at (0.42, -0.08, 0.79). Beaker at (0.31, 0.12, 0.82). "
                f"Nuts: {3 if not self.poured else 0} of 3 in the beaker. No person within 5 m. Line status: normal.")

    def reset(self):
        self.attempt += 1
        self.poured = False
        self._run("settle", 12)

    def execute(self, phase, plan, recheck):
        self.plan = plan
        if phase == "pour":
            self._run("pour", int(min(260, max(90, 70 / max(0.2, plan["tilt_speed"])))))
            self.poured = True
        else:
            self._run(phase, FRAMES[phase])
        return True

    def hold(self):
        self._run("hold", 20)

    def result(self):
        if self.plan["tilt_speed"] > 0.5:
            return False, "2 of 3 nuts landed outside the bowl."
        return True, "All 3 nuts landed in the bowl."

    def _run(self, phase, n):
        tilt = self.plan["tilt_speed"] if self.plan else 0.5
        spill = tilt > 0.5
        for i in range(n):
            time.sleep(1 / FPS)  # frames carry real times, interleaved with the event log's
            self.frames.append((time.time(), {"phase": phase, "u": (i + 1) / n, "attempt": self.attempt, "tilt": tilt, "spill": spill}))


def beaker_pose(st):
    """Where the beaker is and how far it is tipped, for one frame's state."""
    start, over = (300, 300), (600, 250)
    p, u = st["phase"], st["u"]
    if p == "settle":
        return start, 0
    if p == "approach":
        return (start[0] + (over[0] - start[0]) * u, start[1] + (over[1] - start[1]) * u), 0
    if p == "pour":
        return over, 115 * min(1, u * 1.6)
    if p == "return":
        return (over[0] + (start[0] - over[0]) * u, over[1] + (start[1] - over[1]) * u), 115 * (1 - u)
    return over, 0


def draw_wide(n, st):
    img = Image.new("RGB", (W, H), (11, 13, 16))
    d = ImageDraw.Draw(img)
    for x in range(0, W, 40):
        d.line([(x, 0), (x, H)], fill=(18, 21, 26))
    d.rectangle([150, 380, 820, 392], fill=(52, 56, 64))                     # bench
    d.arc([560, 300, 760, 400], 0, 180, fill=(200, 204, 210), width=5)        # bowl
    d.line([(560, 350), (760, 350)], fill=(90, 94, 100), width=2)
    (bx, by), deg = beaker_pose(st)
    a = math.radians(deg)
    pts = [(-22, -45), (22, -45), (22, 45), (-22, 45)]
    d.polygon([(bx + x * math.cos(a) - y * math.sin(a), by + x * math.sin(a) + y * math.cos(a)) for x, y in pts], outline=(236, 238, 240), width=3)
    d.line([(180, 380), (180, 150), (bx - 30, by)], fill=(120, 126, 136), width=6)  # arm
    if st["phase"] in ("pour", "return", "settle") and (st["phase"] != "settle"):
        k = st["u"] if st["phase"] == "pour" else 1
        for i in range(3):
            fall = max(0.0, min(1.0, k * 1.8 - 0.4 - i * 0.15))
            if fall <= 0:
                continue
            x0, y0 = bx + 30, by + 10
            x1 = (620 + i * 40) if not st["spill"] or i == 0 else (800 + i * 30)
            y1 = 365 if not st["spill"] or i == 0 else 375
            d.ellipse([x0 + (x1 - x0) * fall - 6, y0 + (y1 - y0) * fall - 6, x0 + (x1 - x0) * fall + 6, y0 + (y1 - y0) * fall + 6], fill=(220, 222, 226))
    d.rectangle([0, 0, W, 30], fill=(20, 23, 28))
    d.text((12, 9), f"FIXTURE - synthetic video, not Isaac Sim   attempt {st['attempt']}   {st['phase']}   tilt_speed {st['tilt']:.2f}   frame {n}", fill=(160, 166, 176))
    return img


def draw_pov(n, st):
    img = Image.new("RGB", (PW, PH), (16, 18, 22))
    d = ImageDraw.Draw(img)
    d.ellipse([110, 110, 370, 260], outline=(200, 204, 210), width=4)
    d.text((10, 8), f"FIXTURE head camera   {st['phase']}   frame {n}", fill=(160, 166, 176))
    if st["phase"] == "pour":
        for i in range(3):
            if st["u"] > 0.3 + i * 0.15:
                x = 220 + i * 20 if not st["spill"] or i == 0 else 400 + i * 20
                d.ellipse([x - 7, 180, x + 7, 194], fill=(220, 222, 226))
    return img


def encode(path, size, frames):
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{size[0]}x{size[1]}",
                             "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", str(path)],
                            stdin=subprocess.PIPE)
    for img in frames:
        proc.stdin.write(img.tobytes())
    proc.stdin.close()
    if proc.wait():
        raise SystemExit(f"ffmpeg failed on {path}")


def isaac_take(runs, take, seed, video=True):
    takes = runs / "takes"
    store = LessonStore(takes / f"{take}.lessons.json")
    log = EventLog(runs, take=take)
    log("take", mode="isaac", demo=0, use_lessons=True, lessons=store.lessons, verifier="sapling-offline",
        sapling_weights=None, model="offline", lessons_file=str(store.path), steward=tasks.manifest(),
        offline=True, fixture=True)
    world = FixtureWorld(seed)
    on_call = lambda **c: log("call", robot="robot-A", **c)  # noqa: E731
    model = MubitModel(OfflineClient(seed), on_call=on_call, verifier=OfflineSapling(on_call=on_call, seed=seed), via="offline")
    outcome = run_task(world, model, store, log, "robot-A")
    if video:
        encode(takes / f"{take}.mp4", (W, H), (draw_wide(i, s) for i, (_, s) in enumerate(world.frames)))
        encode(takes / f"{take}.pov.mp4", (PW, PH), (draw_pov(i, s) for i, (_, s) in enumerate(world.frames)))
        (takes / f"{take}.frames.json").write_text(json.dumps({"fps": FPS, "times": [t for t, _ in world.frames]}))
    print(f"{take}: {outcome}, {len(world.frames)} frames{'' if video else ' (no video)'}")


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    runs = Path(sys.argv[1]).resolve()
    (runs / "takes").mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "STEWARD_RUNS_DIR": str(runs)}
    subprocess.run([sys.executable, "-m", "steward.practice", "--offline", "--episodes", "8", "--workers", "2",
                    "--seed", "3", "--take", "practice-offline-fixture"], cwd=ROOT, env=env, check=True)
    isaac_take(runs, "robot-A-fixture-01", seed=11)
    isaac_take(runs, "robot-A-fixture-02", seed=12, video=False)
    subprocess.run([sys.executable, str(ROOT / "video/prepare.py")], cwd=ROOT, env=env, check=True)
    print(f"Fixture runs in {runs}")


if __name__ == "__main__":
    main()
