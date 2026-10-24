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
(25 kept examples by default) to start training alongside Isaac takes.
The spill outcome is a toy formula, not physics; every plan, verdict and lesson is
a live call.

```
python -m steward.practice --episodes 3 --workers 1    # smoke test
python -m steward.practice --episodes 40 --workers 4
```

Recorded practice runs covered 120 episodes: 119 succeeded and 1 stopped, with
143 plan, 546 safety-check and 23 lesson calls.

Then open the Mubit console: **Tasks** should list three tasks (plan, verify, lesson).

## Isaac Sim takes (DGX Spark)

Isaac Sim 5.1 (ARM wheel) and Isaac Lab 2.3 live in `~/steward` on the DGX; this repo
is copied to `~/steward/repo`. The scene is Isaac Lab's GR-1 nut pour, and the robot's
motion is a human demo from `~/steward/datasets/dataset_annotated_gr1_nut_pouring.hdf5`,
replayed joint by joint. Each take uses three steel nuts. Only the plan's
`tilt_speed` changes motion; `arm_speed`, `pour_height_cm` and `tilt_angle_deg`
are ignored by the replay.

```
source ~/steward/isaac-env.sh   # venv, EULA, libgomp preload, cd IsaacLab

# physics tuning only: fixed numbers, no model calls
./isaaclab.sh -p ~/steward/repo/isaac/tune_pour.py --headless --enable_cameras --tilt 0.2 0.5 0.8

# a take: the full loop through Mubit, with video
./isaaclab.sh -p ~/steward/repo/isaac/run_pour.py --headless --enable_cameras --video --takes 5
```

Each take writes `runs/takes/<take>.jsonl` and `.lessons.json`; with `--video`,
it also writes `.mp4` and `.frames.json`. By default, each take starts with no lessons.
A second-robot take has not been recorded. To reuse robot-A's lessons, add
`--robot robot-B --lessons <robot-A lessons file>` to the take command.

## The player

```
video/pull.sh          # copy takes from the DGX, make seekable copies → runs/web/
python3 video/serve.py # http://localhost:8000/player/
```

The video is only the simulation, recorded at 100 fps in 1080p (every render, one per
physics step), and plays at 0.5× by default (Speed menu) — slow motion of a run whose
physics ran at full speed. The page plays it with the panel beside it, in sync:
at each decision (plan, safety check, result, lesson) it pauses briefly and reveals it,
because the simulation itself was paused while each model call ran. Scrubbing jumps the
panel straight to that moment. Pick a take from the menu; it opens on a clean
"spills → lands" one. `/panel/` is the same panel following a take live.

## The loop (`steward/loop.py`)

Per attempt: reset the scene → recall lessons → plan → for each phase (approach,
pour, return): verify, then execute → check the result → on failure write a lesson
and start again from the top. The robot only moves on a verdict that is `supported`
and `decided`; anything else, including a failed call, holds or stops it.

`isaac/pour_world.py` implements the `World` protocol and counts nuts in the bowl
to decide success. After a spill, the lesson model reads the failed settings and
result; the next plan reads the saved lesson. Retries reset the scene and are
limited to three attempts by default.

Physics is noisy. In the six most recent takes, first plans chose `tilt_speed`
0.55–1.0 and failed five times (four spills, one nut left in the beaker). Pours at 0.5 or below landed six of eight times.
All seven retries were slower than the preceding attempt; every finished take
succeeded within three attempts. Takes are selected for the demo.

No person is present in the Isaac scene; all 45 recorded Isaac safety checks
returned `supported`. The hold/stop path is unit-tested but not shown in the sim.
Median model-call latency was 2.53 s over 735 practice calls and 2.59 s over
81 Isaac calls.

## The three Mubit tasks (`steward/tasks.py`)

| Task | Input | Output |
|---|---|---|
| plan | scene + fleet lessons | arm speed, pour height, tilt speed, tilt angle, justification |
| verify | policy, evidence, claim (Banyan Sapling's inputs) | label, status, reason |
| lesson | description, settings used, what went wrong | one-sentence lesson + match words |

Instructions and schemas are fixed per task; anything that changes per call goes in
the user message, so each stays one Mubit task. Every model call goes through
Mubit's OpenAI-compatible gateway in `steward/model.py`.

Mubit records plans that apply lessons as well as first plans that spill. Nothing
tells it which plan failed. Adapters can learn to apply a lesson in the prompt;
these records do not teach that the first plan was wrong. Each call's `request_id`
is logged but is not used yet. No adapter result or speedup has been demonstrated.
