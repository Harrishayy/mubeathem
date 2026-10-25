# Steward's event log: the contract

Every take writes one JSON object per line to `runs/takes/<take>.jsonl`. The same lines go
to `runs/latest.jsonl` while it runs (`steward/events.py`). The console reads only these
files, so a field added here is the only change needed for it to reach the console.

Every line has `t` (unix seconds), `take`, `kind` and, except `take`, `robot`.
Tests for the shapes below are in `tests/test_events.py`.

| kind | fields | written by |
|---|---|---|
| `take` | `mode` (`isaac` \| `practice`), `verifier` (`sapling` \| `stand-in` \| `sapling-offline`), `model`, `lessons`, `lessons_file`, `use_lessons`, `offline`, `fixture`, `sapling_weights`, `steward` (the manifest, below) | `isaac/run_pour.py`, `steward/practice.py` |
| `attempt` | `attempt`, `subject` | `loop.run_task` |
| `lessons` | `lessons`: `[{id, text}]` recalled for this attempt | `loop.run_task` |
| `call` | `task` (`plan` \| `verify` \| `lesson`), `via`, `ms`, plus the payload fields below | `model.MubitModel`, `sapling.SaplingVerifier`, `offline.*` |
| `plan` | `attempt`, `plan`: `{arm_speed, pour_height_cm, tilt_speed, tilt_angle_deg, justification}` | `loop.run_task` |
| `phase` | `phase` (`approach` \| `pour` \| `return`) | `loop.run_task` |
| `safety` | `phase`, `label`, `status` (`decided` \| `unsure`), `reason`, `by`, and `sapling` (`{raw_label, prediction_set, probabilities}`) when Sapling made the check | `loop.gate` |
| `hold` / `escalate` | `phase`, `reason` | `loop.gate` |
| `result` | `attempt`, `success`, `reason` | `loop.run_task` |
| `lesson` | `lesson`: the stored lesson (`id, text, applies_to, source_robot, uses, successes, created_at`) | `loop.run_task` |
| `error` | `where` (`plan` \| `verify` \| `lesson`), `error` | `loop` |
| `outcome` | `outcome` (`success` \| `failed` \| `stopped`) | `loop.finish` |

## Call payloads

A `call` line is logged right after the call returns, and before the decision it
produced. That order is how a reader pairs each call with its `plan`, `safety` or `lesson`.

- **`via`** is one of:
  - `mubit`: Mubit's gateway.
  - `sapling`: Banyan Sapling.
  - `offline` / `sapling-offline`: the scripted stand-ins in `steward/offline.py`.
- **Through Mubit** (`via: mubit` or `offline`):
  - `sent`: `{user}`. The system instructions and schema are fixed per task and live in the take's manifest.
  - `got`: the parsed JSON answer.
  - `request_id`, `model`, `usage` (`{prompt_tokens, completion_tokens, total_tokens}`), `finish_reason`.
- **Through Sapling** (`via: sapling` or `sapling-offline`):
  - `sent`: `{policy, evidence, claim}`.
  - `got`: Sapling's whole answer, `{status, raw_label, prediction_set, probabilities}`.
- **A failed call** logs `error` instead of `got`, then raises. The loop then logs an `error` event and stops the robot (it fails closed).

## The manifest (`take.steward`)

`tasks.manifest()` holds everything fixed per task:

- `phases`, `policy` (the stand-in's wording), `ranges`;
- `sapling`: `{policy, phase_steps}`, the wording Sapling gets (its claim is "The robot may run the <phase> phase now.");
- `tasks.<plan|verify|lesson>`: `{instructions, schema}`.

With it, a reader can rebuild the exact prompt behind any call.

## Files beside a take

| File | What it is |
|---|---|
| `<take>.lessons.json` | The take's lesson file (a `LessonStore`). Practice runs share `runs/practice-lessons.json`; `--offline` runs use `runs/offline-lessons.json`, which the console ignores. |
| `<take>.mp4` / `<take>.pov.mp4` | Isaac takes: the wide view and the head camera. |
| `<take>.frames.json` | `{fps, times}`: the wall-clock time of every video frame, used to put events on the video's timeline. |
| `runs/web/<take>.mp4` | The player copy that `video/prepare.py` makes, with the head camera inset. |

Lesson files are the source of truth. `LessonStore` re-reads the file before every recall
and write, and it never recalls a lesson marked `"retired": true`. So edits made by the
console, or by hand, reach robots that are already running.
