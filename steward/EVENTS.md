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
  - `mubit_request_id`: the gateway's `x-middleware-request-id` header, or null if unavailable. `request_id` remains the provider completion ID.
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

## Adversarial action comparisons

`python3 -m steward.security` writes a separate `runs/security/<run_id>/` experiment.
It never labels these recordings as Isaac takes or mixes them into the fleet's lesson store.
Only a completed `report.json` with `mode: live` and `schema_version: 1` is served by
the console's `/api/safety`. Opening the page or checking health reads files only.

New pour reports record `task: pour-adversarial` (reports without `task` are this pour
comparison) and `ranges`, each plan setting's `[low, high]` from the manifest. No report
records the Sapling endpoint: a report is evidence to share, and the URL of a hosted
endpoint would let anyone spend it. Older reports that hold one (`sapling_url`,
`physics_app_url`, probe `record.url`) are scrubbed by the console before serving, and by
`python -m steward.evidence` when copied into `evidence/`.

The frozen `suite.json` precedes Sapling calls and its SHA-256 is recorded. Each case
has its attack text, split, expected safety, and ordered steps. Each step records the
trusted scene (`person_m`, `bowl_known`, `state`), actual proposed `plan`, exact Sapling
`fields`, numeric scoring oracle (`oracle_safe`), `call` (`sent`, `got` or `error`, `ms`),
and `decision` (`allow`, `label`, `status`, `reason`, `source`, `calibrated_status`).
The scoring oracle never decides whether the protected robot may execute.

`events.jsonl` contains these records in order:

| kind | fields |
|---|---|
| `security_run` | `run_id`, `mode`, `policy`, `simulation`, `models` |
| `security_case` | `case`, `category`, `split`, `attack`, `expected_safe` |
| `security_check` | `case`, `step`, plus the complete step above |
| `security_physics` | `case`, `variant`, and measured simulation output |
| `security_summary` | case counts, unsafe approvals, safe rejections, observed unsafe executions, calls and timings |

Every variant has `<case>.<baseline|protected>.physics.json`, containing measured joint
trajectories, contacts and metrics, plus its corresponding MP4. Variant proposals and
physical seeds match; only actuator admission changes. `unsafe_executed_steps` means
an admitted action broke one of the written policy rules; physical contact is a
separate measurement. These are replayed Panda actions in PyBullet on Modal, not VLA
outputs, fluid simulation or injury estimates. Mubit planner calls retain their original
manifest and replies; `models.mubit_adapter` is false. Wider infrastructure probe
results and batching validation appear in `report.validation`, when available.

### Knife / actual VLA extension

Reports with `task: knife-handover` keep schema version 1 and the same event sequence,
but have a task-specific plan: `{action: [7 finite values], duration_s, justification}`.
`bowl_known` and `person_m` are not required for this task. Each check additionally
records `instruction`, `action`, measured `telemetry`, full `physics_telemetry`, raw
`vla_call` and the effective `execute` mask. The VLA call includes actual generated
tokens, exact prompt, model revision, dataset statistics, image SHA-256 and runtime.
Snapshots and input images are retained under `frames/<step>/`.

`models.vla` supplies `{id, revision, unnorm_key, domain_shift_note}`. `cameras` names
the simultaneous human-eye and side views. Physics outputs include source/job hashes,
requested/applied targets, clipping, realized knife trajectory, minimum clearance,
tool contacts and per-camera visibility. `safe_proposals[_allowed]` and
`unsafe_proposals[_allowed]` count raw verifier decisions; `safe_allowed` counts whole
safe episodes approved at every step. A denied episode stays held, even if later raw
labels are supported. `mubit_calls` is zero for this experiment: the planner is actual
OpenVLA, and Sapling is the Mubit Labs verifier. Earlier pour reports remain valid.

`presentation: single-example` selects the focused viewer and is valid only for a
one-case knife report. `featured_case_id` identifies that case. `selection` records
the preserved development episode's path and SHA-256, prompt-search manifest and
selection note. Selecting an observed approach for presentation does not turn it
into a held-out benchmark. All development candidates remain on disk. The importer
checks source-image hashes, independently decodes generated action tokens, verifies
the observation histories and final measured trajectory, then obtains fresh Sapling
decisions from the protected branch's measured state. It publishes only after both
rendered physics jobs match their exact action and source hashes.

The near-touch extension uses `scenario: near-close` and explicit `human_x_m` in
both paired jobs. `scene_source_sha256` binds the closer placement, applied before
all real VLA observations. Canonical jobs can use `render: false`; their trajectory
and numeric metrics remain unchanged. Separate `*.render.json` files bind native
60 fps camera recordings to each canonical file's SHA-256 and verify every shared
measurement tick. The report retains those manifests in each variant's `rendering`.

`playback_timeline` contains ordered `{start_s, end_s, step_index, kind,
physics_start_s, physics_end_s}` segments. `step_index: null` is an initial hold;
an end hold retains its last action index and fixed physics time. Diagrams use real
recorded labels and admission masks. Clearance is interpolated from canonical
telemetry in the page, and measured directly from dense geometry inside the video.
Initial and final display holds freeze physics, while inference waiting time is
omitted. `rendering.fps` describes the visual recording; canonical `fps` describes
the original measurement cadence when no canonical video was generated.
