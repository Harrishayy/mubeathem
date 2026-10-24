"""Physics tuning only: pour with fixed numbers, no planner, no Mubit, no event log.

Use it to find the tilt speed that spills and the one that lands, then leave the
scene alone. Never record a take with it: takes come from run_pour.py.

    ./isaaclab.sh -p ~/steward/repo/isaac/tune_pour.py --headless --tilt 0.2 0.5 0.8
"""

import argparse
import os
import sys
from pathlib import Path

from isaaclab.app import AppLauncher

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
parser.add_argument("--dataset", default=str(Path.home() / "steward/datasets/dataset_annotated_gr1_nut_pouring.hdf5"))
parser.add_argument("--demo", type=int, default=0)
parser.add_argument("--nuts", type=int, default=3)
parser.add_argument("--restitution", type=float, default=None)
parser.add_argument("--tilt", type=float, nargs="+", default=[0.2, 0.5])
parser.add_argument("--pour-height", type=float, nargs="+", default=[8.0])
parser.add_argument("--repeats", type=int, default=1)
parser.add_argument("--video", action="store_true")
parser.add_argument("--name", default="tune", help="Video file name under runs/tuning/.")
AppLauncher.add_app_launcher_args(parser)
args = parser.parse_args()

import pinocchio  # noqa: F401,E402

app = AppLauncher(args).app

from isaac.pour_world import PourWorld  # noqa: E402
import numpy as np  # noqa: E402

from steward.tasks import PHASES  # noqa: E402


def main():
    world = PourWorld(args.dataset, demo=args.demo, robot="tuning", nuts=args.nuts,
                      restitution=args.restitution, video=args.video, device=args.device)
    print(f"Pour segment: steps {world.pour_start}-{world.pour_end}, return ends at {world.return_end}, "
          f"bowl radius {world.bowl_radius:.3f} m")
    print(world.subject())
    print("Joints the demo starts bent:", world.joint_check())
    for height in args.pour_height:
        for tilt in args.tilt:
            for repeat in range(args.repeats):
                plan = {"arm_speed": 0.3, "pour_height_cm": height, "tilt_speed": tilt, "tilt_angle_deg": 130}
                world.reset()
                for phase in PHASES:
                    world.execute(phase, plan, recheck=lambda: True)
                    in_bowl, in_beaker, outside = world._count_nuts()
                    print(f"  after {phase:8} bowl {in_bowl} beaker {in_beaker} outside {outside}  "
                          f"beaker at {world._pos('sorting_beaker').round(3)}")
                ok, reason = world.result()
                bowl = world._pos("sorting_bowl")
                for nut in world.nuts:
                    p = world._pos(nut)
                    print(f"    {nut:14} {np.linalg.norm(p[:2] - bowl[:2]) * 100:5.1f} cm from bowl centre, "
                          f"z {p[2] - bowl[2]:+.3f}")
                print(f"tilt {tilt:.2f} height {height:4.1f} #{repeat}: {'LANDS' if ok else 'SPILLS'}  {reason}")
    if args.video:
        print("video:", world.save_video(REPO / f"runs/tuning/{args.name}.mp4"))


if __name__ == "__main__":
    main()
    sys.stdout.flush()
    os._exit(0)  # app.close() can hang on the DGX, and everything is saved by now
