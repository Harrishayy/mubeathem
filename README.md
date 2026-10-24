# Steward

A governing layer for robot fleets, shown on a humanoid pouring in Isaac Sim. Robots
share lessons from their failures, every plan is safety-checked before it runs, and
every decision is a model call through Mubit's gateway, which trains the recurring
ones into adapters.

## Setup

```
pip install -r requirements.txt
cp .env.example .env        # add MUBIT_API_KEY
python -m pytest -q tests   # offline, no model calls
```

## Practice runs (start these first)

The full loop on a text-only toy world, so Mubit gets enough examples of each task
(25 kept examples by default) to start training while the Isaac scene is built.
The spill outcome is a toy formula, not physics; every plan, verdict and lesson is
a live call.

```
python -m steward.practice --episodes 3 --workers 1    # smoke test
python -m steward.practice --episodes 40 --workers 4
```

Then open the Mubit console: **Tasks** should list three tasks (plan, verify, lesson).

## Isaac Sim takes (DGX Spark)

Isaac Sim 5.1 (ARM wheel) and Isaac Lab 2.3 live in `~/steward` on the DGX; this repo
is copied to `~/steward/repo`. The scene is Isaac Lab's GR-1 nut pour, and the robot's
motion is a human demo from `~/steward/datasets/dataset_annotated_gr1_nut_pouring.hdf5`,
replayed joint by joint; the plan's tilt speed sets how fast the pour plays.

```
source ~/steward/isaac-env.sh   # venv, EULA, libgomp preload, cd IsaacLab

# physics tuning only: fixed numbers, no model calls
./isaaclab.sh -p ~/steward/repo/isaac/tune_pour.py --headless --enable_cameras --tilt 0.2 0.5 0.8

# a take: the full loop through Mubit, with video
./isaaclab.sh -p ~/steward/repo/isaac/run_pour.py --headless --enable_cameras --video --takes 5
```

Each take writes `runs/takes/<take>.jsonl`, `.mp4` and `.frames.json`.

## The player

```
video/pull.sh          # copy takes from the DGX, make 60 fps copies → runs/web/
python3 video/serve.py # http://localhost:8000/player/
```

The video is only the simulation. The page plays it with the panel beside it, in sync:
at each decision (plan, safety check, result, lesson) it pauses briefly and reveals it,
because the simulation itself was paused while each model call ran. Scrubbing jumps the
panel straight to that moment. Pick a take from the menu; it opens on a clean
"spills → lands" one. `/panel/` is the same panel following a take live.

## The loop (`steward/loop.py`)

Per attempt: reset the scene → recall lessons → plan → for each phase (approach,
pour, return): verify, then execute → check the result → on failure write a lesson
and start again from the top. The robot only moves on a verdict that is `supported`
and `decided`; anything else, including a failed call, holds or stops it.

A world supplies the scene and carries out plans. To plug in Isaac Sim, implement
the `World` protocol: `subject()`, `describe()`, `reset()`, `execute(phase, plan,
recheck)`, `hold()` and `result()`. Step the simulation yourself inside `execute`,
and call `recheck()` when a person crosses 2 m or 1 m.

## The three Mubit tasks (`steward/tasks.py`)

| Task | Input | Output |
|---|---|---|
| plan | scene + fleet lessons | arm speed, pour height, tilt speed, tilt angle, justification |
| verify | policy, evidence, claim (Banyan Sapling's inputs) | label, status, reason |
| lesson | description, settings used, what went wrong | one-sentence lesson + match words |

Instructions and schemas are fixed per task; anything that changes per call goes in
the user message, so each stays one Mubit task.
