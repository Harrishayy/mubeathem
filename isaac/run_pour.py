"""Takes: the loop runs the GR-1 pour in Isaac Sim, plans and lessons through Mubit,
safety checks by Banyan Sapling (start sapling/serve.py first and set SAPLING_URL).

From ~/steward/IsaacLab, after `source ~/steward/isaac-env.sh`:
    ./isaaclab.sh -p ~/steward/repo/isaac/run_pour.py --headless --enable_cameras --video --takes 5

Each take starts with an empty lesson file of its own: attempt 1 plans with no
lessons, a spill writes a lesson, the scene resets, and the next attempt plans with
it. Every take keeps its event log, lessons and video in runs/takes/, so takes can
be compared later. Several takes share one launch of Isaac Sim.
"""

import argparse
import os
import functools
import json
import sys
import time
from pathlib import Path

from isaaclab.app import AppLauncher

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
parser.add_argument("--dataset", default=str(Path.home() / "steward/datasets/dataset_annotated_gr1_nut_pouring.hdf5"))
parser.add_argument("--demo", type=int, default=0)
parser.add_argument("--robot", default="robot-A")
parser.add_argument("--takes", type=int, default=1)
parser.add_argument("--lessons", default=None,
                    help="A shared lesson file (e.g. to show a second robot using robot-A's lesson). "
                         "By default each take starts with an empty one.")
parser.add_argument("--no-lessons", action="store_true", help="Plan without fleet memory (a control robot).")
parser.add_argument("--max-attempts", type=int, default=3)
parser.add_argument("--nuts", type=int, default=3)
parser.add_argument("--restitution", type=float, default=None)
parser.add_argument("--video", action="store_true")
parser.add_argument("--stand-in", action="store_true",
                    help="Safety checks by the stand-in model through Mubit, in Sapling's format, instead of "
                         "Sapling itself. Each take's log says which made its checks.")
AppLauncher.add_app_launcher_args(parser)
args = parser.parse_args()

import pinocchio  # noqa: F401,E402  (the pour task's config imports Pink IK)

app = AppLauncher(args).app

from isaac.pour_world import PourWorld  # noqa: E402
from steward import config, tasks  # noqa: E402
from steward.events import EventLog  # noqa: E402
from steward.lessons import LessonStore  # noqa: E402
from steward.loop import run_task  # noqa: E402
from steward.model import MubitModel, mubit_client  # noqa: E402
from steward.sapling import SaplingVerifier  # noqa: E402


def main():
    sapling = None
    if not args.stand_in:
        if not config.SAPLING_URL:
            raise SystemExit("Set SAPLING_URL: takes run their safety checks on Banyan Sapling (sapling/serve.py),"
                             " or pass --stand-in.")
        sapling = SaplingVerifier(config.SAPLING_URL).health()  # fail now, not at the first check
    world = PourWorld(args.dataset, demo=args.demo, robot=args.robot, nuts=args.nuts,
                      restitution=args.restitution, video=args.video, device=args.device)
    client = mubit_client()
    takes_dir = config.RUNS_DIR / "takes"

    for _ in range(args.takes):
        take = f"{args.robot}-{time.strftime('%Y%m%d-%H%M%S')}"
        store = LessonStore(args.lessons or takes_dir / f"{take}.lessons.json")
        log = EventLog(config.RUNS_DIR, take=take)
        log("take", mode="isaac", demo=args.demo, use_lessons=not args.no_lessons,
            lessons=[] if args.no_lessons else store.lessons,
            verifier="sapling" if sapling else "stand-in",
            sapling_weights=sapling["weights_sha256"] if sapling else None,
            model=config.MODEL, lessons_file=str(store.path), steward=tasks.manifest())

        if args.video:
            world.start_recording(takes_dir / f"{take}.mp4")
        on_call = functools.partial(log, "call", robot=args.robot)
        verifier = SaplingVerifier(config.SAPLING_URL, on_call=on_call) if sapling else None
        model = MubitModel(client, on_call=on_call, verifier=verifier)
        outcome = run_task(world, model, store, log, args.robot,
                           max_attempts=args.max_attempts, use_lessons=not args.no_lessons)

        video = world.stop_recording()
        events = [json.loads(line) for line in (takes_dir / f"{take}.jsonl").read_text().splitlines()]
        attempts = [e for e in events if e["kind"] == "result"]
        story = " → ".join("lands" if e["success"] else "spills" for e in attempts)
        print(f"TAKE {take}: {outcome} ({story})" + (f", video {video.name}" if video else ""), flush=True)


if __name__ == "__main__":
    main()
    sys.stdout.flush()
    os._exit(0)  # app.close() can hang on the DGX, and everything is saved by now
