"""Text-only practice runs: the full Steward loop on a toy world, so Mubit sees enough
examples of each task to train adapters while the Isaac Sim scene is being built.

The spill outcome here is a toy formula, not physics. Say "text-only practice runs"
when you mention these. Every plan, verdict and lesson is still a live call.

    python -m steward.practice --episodes 40 --workers 4
    python -m steward.practice --offline     # scripted Mubit and Sapling stand-ins, no keys

--offline runs the same loop against steward/offline.py, so the console can be tried
end to end without spending anything; its takes say offline: true.
"""

import argparse
import random
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from . import config, tasks
from .events import EventLog
from .lessons import LessonStore
from .loop import run_task
from .model import MubitModel, mubit_client
from .offline import OfflineClient, OfflineSapling
from .sapling import SaplingVerifier

# (description, how readily it bounces or slides out of a stream)
CONTENTS = [
    ("small loose hex nuts, about 80 pieces", 1.0),
    ("glass marbles, about 40", 1.4),
    ("ice cubes, about 15", 1.1),
    ("dry rice, about 200 g", 0.7),
    ("wooden blocks, 2 cm cubes, about 20", 0.5),
    ("cereal flakes, about 60 g", 0.4),
]

# (description, how forgiving it is to catch a stream)
BOWLS = [
    ("wide ceramic bowl, 22 cm across", 1.3),
    ("small steel bowl, 12 cm across", 0.8),
    ("narrow measuring cup, 8 cm across", 0.6),
]


class PracticeWorld:
    def __init__(self, robot, rng):
        self.robot = robot
        self.rng = rng
        self.contents, self.scatter = rng.choice(CONTENTS)
        self.bowl, self.width = rng.choice(BOWLS)
        self.plan = None

    def subject(self):
        return f"Beaker of {self.contents}. Pouring into a {self.bowl}."

    def describe(self):
        bowl = (f"Bowl at ({self.bowl_xyz[0]:.2f}, {self.bowl_xyz[1]:.2f}, {self.bowl_xyz[2]:.2f})"
                if self.bowl_seen else "Bowl position unknown (camera view blocked)")
        person = (f"Nearest person: {self.person_m:.1f} m from the robot."
                  if self.person_m < 5 else "No person within 5 m.")
        return (f"Robot {self.robot}. Holding a beaker of {self.contents}. "
                f"Pouring into a {self.bowl}. {bowl}. "
                f"Beaker {'over the bowl' if self.over_bowl else 'at the start pose'}. {person}")

    def reset(self):
        self.bowl_xyz = (round(self.rng.uniform(0.35, 0.5), 2),
                         round(self.rng.uniform(-0.15, 0.15), 2), 0.78)
        self.bowl_seen = self.rng.random() > 0.05
        self.person_m = self.rng.choice([9.0, 9.0, 9.0, 9.0, 3.5, 1.6])
        self.over_bowl = False

    def execute(self, phase, plan, recheck):
        self.plan = plan
        if self.rng.random() < 0.08:
            self.person_m = self.rng.choice([1.6, 0.8])
            if not recheck():
                return False
        self.over_bowl = phase == "approach" or (phase == "pour" and self.over_bowl)
        return True

    def hold(self):
        self.person_m = self.rng.choice([9.0, 3.5]) if self.rng.random() < 0.7 else self.person_m
        self.bowl_seen = True

    def result(self):
        speed = max(0.0, self.plan["tilt_speed"] - 0.3) * 2.0
        height = max(0.0, self.plan["pour_height_cm"] - 8) / 30
        spill = self.scatter * (speed + height) / self.width + self.rng.gauss(0, 0.02)
        spill = min(1.0, max(0.0, spill))
        if spill <= 0.10:
            return True, f"{round((1 - spill) * 100)}% landed in the bowl."
        return False, f"{round(spill * 100)}% of the contents landed outside the bowl."


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--episodes", type=int, default=40)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--lessons", default=None,
                        help="Lesson file (default runs/practice-lessons.json; offline: runs/offline-lessons.json).")
    parser.add_argument("--take", default=None, help="Name for this run's take (default: a timestamp).")
    parser.add_argument("--offline", action="store_true",
                        help="Scripted Mubit and Sapling stand-ins (steward/offline.py): no keys, no network.")
    args = parser.parse_args()
    # Stand-in lessons never land in the fleet file real robots recall from.
    if args.lessons is None:
        args.lessons = str(config.RUNS_DIR / ("offline-lessons.json" if args.offline else "practice-lessons.json"))

    client = OfflineClient(args.seed) if args.offline else mubit_client()
    store = LessonStore(args.lessons)
    log = EventLog(config.RUNS_DIR, take=args.take)
    verifier = "sapling-offline" if args.offline else "sapling" if config.SAPLING_URL else "stand-in"
    log("take", mode="practice", offline=args.offline, lessons=store.lessons, use_lessons=True,
        verifier=verifier, model=config.MODEL, lessons_file=str(args.lessons), steward=tasks.manifest())
    calls = Counter()
    calls_lock = threading.Lock()

    def episode(index):
        robot = f"practice-{index % args.workers + 1}"
        seed = None if args.seed is None else args.seed + index
        rng = random.Random(seed)

        def on_call(**call):
            with calls_lock:
                calls[f"{call['task']} via {call['via']}"] += 1
            log("call", robot=robot, **call)

        if args.offline:
            sapling = OfflineSapling(on_call=on_call, seed=seed)
        else:
            sapling = SaplingVerifier(config.SAPLING_URL, on_call=on_call) if config.SAPLING_URL else None
        model = MubitModel(client, on_call=on_call, verifier=sapling, via="offline" if args.offline else None)
        return run_task(PracticeWorld(robot, rng), model, store, log, robot)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        outcomes = Counter(pool.map(episode, range(args.episodes)))

    print(f"Episodes: {dict(outcomes)}")
    print(f"Model calls: {dict(calls)}")
    print(f"Lessons in {args.lessons}: {len(store.lessons)}")


if __name__ == "__main__":
    main()
