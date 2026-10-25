"""Knife observations, canonical simulation and verified dense rendering on Modal.

Use the repository's team credentials:
    python3 deploy/modal/team.py run deploy/modal/knife_simulation.py \
        --jobs /abs/jobs.json --output /abs/output --mode snapshot
    python3 deploy/modal/team.py run deploy/modal/knife_simulation.py \
        --jobs /abs/jobs.json --output /abs/output --mode simulate
    python3 deploy/modal/team.py run deploy/modal/knife_simulation.py \
        --jobs /abs/jobs.json --output /abs/output --mode render \
        --canonical-dir /abs/canonical

Jobs with scenario="near-close" use the audited closer-person scene, including
their exact human_x_m placement. Other jobs use the original knife scene. Render
mode verifies replay against canonical physics; it never writes canonical files.
These functions do not call a model. OpenVLA inference lives in vla.py.
"""

import modal

app = modal.App("steward-knife-physics")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("fonts-dejavu-core")
    .pip_install("pybullet==3.2.7", "numpy==2.2.6", "imageio[ffmpeg]==2.37.0", "Pillow==11.3.0")
    .add_local_python_source("steward")
)


def _in_child(function, payload):
    """Keep native rendering off Modal's heartbeat thread."""
    import multiprocessing
    import os
    from concurrent.futures import ProcessPoolExecutor
    from unittest.mock import patch

    limits = {name: "1" for name in (
        "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"
    )}
    with patch.dict(os.environ, limits):
        with ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn")) as executor:
            child_pid = executor.submit(os.getpid).result()
            result = executor.submit(function, payload).result()
    result["execution"] = {"isolation": "spawned_process", "parent_pid": os.getpid(),
                           "child_pid": child_pid, "numeric_thread_limit": 1}
    return result


def _scene_function(job, name):
    if job.get("scenario") == "near-close":
        from steward import knife_close_scene as scene
    else:
        from steward import knife_physics as scene
    return getattr(scene, name)


@app.function(image=image, cpu=2, memory=3072, max_containers=4, timeout=600, scaledown_window=30)
def snapshot(job: dict) -> dict:
    return _scene_function(job, "snapshot_scene")(job)


@app.function(image=image, cpu=2, memory=3072, max_containers=4, timeout=600, scaledown_window=30)
def simulate(job: dict) -> dict:
    return _in_child(_scene_function(job, "simulate_actions"), job)


@app.function(image=image, cpu=2, memory=3072, max_containers=4, timeout=1200,
              scaledown_window=30, nonpreemptible=True)
def render(payload: dict) -> dict:
    from steward.knife_render import render_recording

    # render_recording checks physics/scene source hashes, action/job hashes,
    # every shared trajectory tick, final poses and canonical measurements.
    return _in_child(render_recording, payload)


def _identifier(job, include_variant=False):
    import re

    identifier = job.get("id")
    if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,159}", identifier):
        raise ValueError("Job ids must be safe filenames of at most 160 characters")
    if include_variant:
        if job.get("variant") not in ("baseline", "protected"):
            raise ValueError("Simulation/render variants must be baseline or protected")
        identifier += "." + job["variant"]
    return identifier


def _render_payloads(jobs, canonical_dir):
    import hashlib
    import json

    payloads, hashes = [], {}
    for job in jobs:
        stem = _identifier(job, include_variant=True)
        data = (canonical_dir / f"{stem}.physics.json").read_bytes()
        hashes[stem] = hashlib.sha256(data).hexdigest()
        payloads.append({"job": job, "canonical": json.loads(data)})
    return payloads, hashes


@app.local_entrypoint()
def main(jobs: str, output: str, mode: str = "simulate", canonical_dir: str = ""):
    import hashlib
    import json
    from pathlib import Path

    if mode not in ("snapshot", "simulate", "render"):
        raise ValueError("mode must be snapshot, simulate or render")
    if mode == "render" and not canonical_dir:
        raise ValueError("--canonical-dir is required for render mode")
    entries = json.loads(Path(jobs).read_text())
    if not isinstance(entries, list) or not all(isinstance(job, dict) for job in entries):
        raise ValueError("--jobs must contain a JSON list of job objects")
    stems = [_identifier(job, include_variant=mode != "snapshot") for job in entries]
    if len(set(stems)) != len(stems):
        raise ValueError("Job ids and variants must identify unique output files")
    destination = Path(output)
    destination.mkdir(parents=True, exist_ok=True)

    if mode == "render":
        payloads, canonical_hashes = _render_payloads(entries, Path(canonical_dir))
        for result in render.map(payloads):
            stem = _identifier(result, include_variant=True)
            result["canonical_sha256"] = canonical_hashes[stem]
            result["raw_video_sha256"] = hashlib.sha256(result["raw_video"]).hexdigest()
            result["stacked_video_sha256"] = hashlib.sha256(result["stacked_video"]).hexdigest()
            (destination / f"{stem}.mp4").write_bytes(result.pop("raw_video"))
            (destination / f"{stem}.stacked.mp4").write_bytes(result.pop("stacked_video"))
            (destination / f"{stem}.render.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
            print(json.dumps({"id": result["id"], "variant": result["variant"],
                              "frames": result["video_frames"], "duration_s": result["duration_s"],
                              "physics_verification": result["physics_verification"],
                              "wall_seconds": result["wall_seconds"]}), flush=True)
        return

    function = snapshot if mode == "snapshot" else simulate
    for result in function.map(entries):
        if mode == "snapshot":
            stem = _identifier(result)
            (destination / f"{stem}.observation.png").write_bytes(result.pop("image_png"))
            views = result.pop("views")
            for name in ("human", "side"):
                (destination / f"{stem}.{name}.png").write_bytes(views[name + "_png"])
            (destination / f"{stem}.snapshot.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
            print(json.dumps({"id": result["id"], "telemetry": result["telemetry"],
                              "visibility": result["view_metrics"]}), flush=True)
        else:
            stem = _identifier(result, include_variant=True)
            video = result.pop("video")
            if video:
                (destination / f"{stem}.mp4").write_bytes(video)
            (destination / f"{stem}.physics.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
            print(json.dumps({"id": result["id"], "variant": result["variant"],
                              "metrics": result["metrics"]}), flush=True)
