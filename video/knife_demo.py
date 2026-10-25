"""Export one verified, annotated knife comparison at its native 60 fps.

    python3 video/knife_demo.py --report /abs/report.json --output /abs/showcase.mp4

Local composition only: no model calls, simulation, frame interpolation or
retiming. Requires Pillow, ffmpeg and ffprobe. Frozen inputs remain untouched.
"""

import argparse
from dataclasses import dataclass
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont


VARIANTS = ("baseline", "protected")
SOURCE_SIZE = (640, 960)
OUTPUT_SIZE = (1280, 1152)
FPS = 60
SAFE_ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
SOURCE_FIELDS = {
    "physics_source_sha256": "steward/knife_physics.py",
    "renderer_source_sha256": "steward/knife_render.py",
    "scene_source_sha256": "steward/knife_close_scene.py",
}
FONT_PATHS = (
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def json_digest(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def read_json(path):
    value = json.loads(Path(path).read_text())
    require(isinstance(value, dict), f"Expected a JSON object: {path}")
    return value


def reject_fixtures(value):
    """Reject explicit synthetic/offline markers in recorded evidence."""
    if isinstance(value, dict):
        for key in ("fixture", "offline", "mock", "is_fixture"):
            require(not value.get(key), f"Synthetic/offline input is not exportable ({key})")
        require(value.get("mode") not in ("offline", "fixture", "mock"),
                "Synthetic/offline input is not exportable")
        require(value.get("via") not in ("offline", "sapling-offline", "stand-in", "fixture", "mock"),
                "Recorded model calls must be live")
        for child in value.values():
            reject_fixtures(child)
    elif isinstance(value, list):
        for child in value:
            reject_fixtures(child)


def probe(path):
    raw = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=width,height,r_frame_rate,duration,nb_frames", "-of", "json", str(path),
    ])
    streams = json.loads(raw).get("streams", [])
    require(len(streams) == 1, f"Expected one video stream: {path}")
    return streams[0]


@dataclass
class ExportInputs:
    report_path: Path
    report: dict
    case: dict
    sources: dict
    render: dict
    duration: float
    frozen_hashes: dict
    video_hash_evidence: dict


def load_inputs(report_path):
    """Verify the frozen report, calls, physics, renderer and encoded sources."""
    report_path = Path(report_path).resolve()
    directory = report_path.parent
    report = read_json(report_path)
    reject_fixtures(report)
    require(type(report.get("schema_version")) is int and report["schema_version"] == 1,
            "Only knife report schema version 1 is supported")
    require(report.get("task") == "knife-handover", "Expected a knife-handover report")
    require(report.get("presentation") == "single-example", "Expected a single-example report")
    require(report.get("mode") == "live" and report.get("completed_at"),
            "A completed live report is required")
    require(isinstance(report.get("cases"), list) and len(report["cases"]) == 1,
            "The report must contain exactly one case")
    case = report["cases"][0]
    require(isinstance(case, dict), "The recorded case must be a JSON object")
    case_id = case.get("id")
    require(isinstance(case_id, str) and SAFE_ID.fullmatch(case_id), "Unsafe case identifier")
    require(report.get("featured_case_id") == case_id, "Featured case does not match the recorded case")
    instruction = case.get("instruction")
    require(isinstance(instruction, str) and instruction.strip(), "Missing recorded instruction")
    steps = case.get("steps")
    require(isinstance(steps, list) and steps, "Missing recorded actions")
    for step in steps:
        require(isinstance(step, dict), "Each recorded step must be a JSON object")
        action = step.get("action")
        require(isinstance(action, list) and len(action) == 7 and all(
            type(value) in (int, float) and math.isfinite(value) for value in action
        ), "Each recorded action must contain seven finite numbers")
        require(type(step.get("execute")) is bool, "Missing recorded execution decision")
        call = step.get("vla_call", {})
        require(isinstance(call, dict) and isinstance(call.get("got"), dict),
                "Missing structured VLA call evidence")
        got = call["got"]
        require(got.get("action7") == action, "VLA call and recorded action disagree")
        require(got.get("model") == "openvla/openvla-7b"
                and got.get("generation_is_action_tokens") is True,
                "Recorded actions must come from actual OpenVLA action generation")
        require(step.get("instruction") == instruction and got.get("instruction") == instruction,
                "Recorded model instructions disagree")
        verifier = step.get("call", {})
        require(isinstance(verifier, dict) and verifier.get("via") == "sapling"
                and isinstance(verifier.get("got"), dict),
                "A successful live Sapling call is required for each action")

    frozen_hashes = {report_path: sha(report_path)}
    render, sources, streams, evidence = {}, {}, {}, {}
    stamp_path = directory / "camera-verified.json"
    stamp = None

    def frozen(path, expected):
        path = path.resolve()
        require(path.is_relative_to(directory), "Artifact path escapes the run directory")
        require(isinstance(expected, str) and SHA256.fullmatch(expected),
                f"Missing or invalid SHA-256 for {path.name}")
        actual = sha(path)
        require(actual == expected, f"Hash mismatch: {path}")
        frozen_hashes[path] = actual

    def legacy_video_hash(variant, source, manifest_path):
        # Immutable captures predating encoded-video hashes use their existing
        # camera stamp, which binds report, manifest bytes and encoded video.
        nonlocal stamp
        if stamp is None:
            stamp = read_json(stamp_path)
            require(stamp.get("passed") is True and stamp.get("case_id") == case_id,
                    "Legacy capture requires a matching successful camera verification stamp")
            require(stamp.get("source_report_sha256") == frozen_hashes[report_path],
                    "Camera verification stamp belongs to a different report")
            frozen_hashes[stamp_path] = sha(stamp_path)
        expected_manifest = stamp.get("render_checks", {}).get(variant, {}).get("render_metadata_sha256")
        frozen(manifest_path, expected_manifest)
        evidence[variant] = "legacy camera-verified.json binds report, renderer manifest and video"
        return stamp.get("videos", {}).get(source.name, {}).get("sha256")

    jobs = report.get("physics_jobs", [])
    require(isinstance(jobs, list) and all(isinstance(job, dict) for job in jobs),
            "Recorded physics jobs must be a list of JSON objects")
    require(isinstance(report.get("source_sha256"), dict), "Missing frozen source hashes")
    presentation_sources = report.get("render_source_sha256")
    require(presentation_sources is None or isinstance(presentation_sources, dict),
            "Invalid frozen presentation source hashes")
    for variant in VARIANTS:
        stem = f"{case_id}.{variant}"
        source = directory / f"{stem}.stacked.mp4"
        manifest_path = directory / f"{stem}.render.json"
        manifest = read_json(manifest_path)
        reject_fixtures(manifest)
        require(manifest.get("id") == case_id and manifest.get("variant") == variant,
                "Renderer manifest identity mismatch")
        require(manifest.get("fps") == FPS and manifest.get("stacked_size") == list(SOURCE_SIZE),
                "Expected native 60fps, 640×960 annotated recordings")
        canonical_path = directory / f"{stem}.physics.json"
        frozen(canonical_path, manifest.get("canonical_sha256"))
        canonical = read_json(canonical_path)
        reject_fixtures(canonical)
        require(canonical.get("id") == case_id and canonical.get("variant") == variant,
                "Canonical physics identity mismatch")
        require(canonical.get("job_sha256") == manifest.get("canonical_job_sha256"),
                "Canonical job hash does not match the renderer")
        matching = [job for job in jobs if job.get("id") == case_id and job.get("variant") == variant]
        require(len(matching) == 1, "Missing unique canonical job in the report")
        job = matching[0]
        require(json_digest(job) == canonical["job_sha256"], "Report job differs from canonical physics")
        require(json_digest({**job, "render": True}) == manifest.get("render_job_sha256"),
                "Renderer job differs from the recorded action replay")

        for field, relative in SOURCE_FIELDS.items():
            recorded = manifest.get(field)
            if field == "scene_source_sha256" and recorded is None:
                continue
            if field == "renderer_source_sha256" and presentation_sources is not None:
                hashes, archive = presentation_sources, directory / "source" / "presentation"
            else:
                hashes, archive = report["source_sha256"], directory / "source"
            require(recorded == hashes.get(relative),
                    f"Renderer and report source hashes disagree: {relative}")
            frozen(archive / relative, recorded)
        require(canonical.get("source_sha256") == manifest.get("physics_source_sha256")
                and canonical.get("scene_source_sha256") == manifest.get("scene_source_sha256"),
                "Canonical scene/physics source differs from the rendered scene")
        require(manifest.get("initial") == canonical.get("initial")
                and manifest.get("final") == canonical.get("final")
                and manifest.get("canonical_metrics") == canonical.get("metrics"),
                "Renderer changed canonical measurements")
        recorded_steps = canonical.get("steps", [])
        require(isinstance(recorded_steps, list) and len(recorded_steps) == len(steps)
                and all(isinstance(step, dict) for step in recorded_steps),
                "Canonical action count or schema mismatch")
        for step, recorded in zip(steps, recorded_steps):
            expected_execute = True if variant == "baseline" else step["execute"]
            require(recorded.get("requested_action") == step["action"]
                    and recorded.get("execute") == expected_execute,
                    "Canonical action or gate decision differs from the report")

        verification = manifest.get("physics_verification", {})
        require(isinstance(verification, dict), "Missing structured physics verification")
        require(verification.get("shared_ticks") == len(canonical.get("trajectory", [])) > 0,
                "Renderer did not verify every shared canonical tick")
        for key in ("max_joint_error_rad", "max_tip_error_m", "max_clearance_error_m"):
            error = verification.get(key)
            require(type(error) in (int, float) and math.isfinite(error) and 0 <= error <= 1e-8,
                    "Dense renderer diverged from canonical physics")
        display = manifest.get("display", {})
        require(isinstance(display, dict), "Missing structured display metadata")
        require(display.get("fps") == FPS and display.get("speed") == 1
                and all(display.get(key) is False for key in
                        ("optical_flow", "pose_interpolation", "action_scaling")),
                "Native physics frames without interpolation or scaling are required")
        require(type(manifest.get("video_frames")) is int
                and isinstance(manifest.get("frame_times"), list)
                and manifest["video_frames"] == len(manifest["frame_times"]) > 0,
                "Dense frame timing metadata is incomplete")
        require(type(manifest.get("duration_s")) in (int, float)
                and math.isfinite(manifest["duration_s"]), "Invalid renderer duration")

        video_hash = manifest.get("stacked_video_sha256")
        if video_hash is None:
            video_hash = legacy_video_hash(variant, source, manifest_path)
        else:
            evidence[variant] = "stacked_video_sha256 in renderer manifest"
        frozen(source, video_hash)
        frozen_hashes[manifest_path] = sha(manifest_path)
        stream = probe(source)
        require((stream.get("width"), stream.get("height")) == SOURCE_SIZE
                and Fraction(stream.get("r_frame_rate", "0")) == FPS,
                "Encoded source is not 640×960 at 60fps")
        duration = float(stream["duration"])
        require(math.isfinite(duration) and duration > 0
                and abs(duration - manifest.get("duration_s", -1)) <= .001
                and abs(duration - manifest["video_frames"] / FPS) <= .001
                and int(stream.get("nb_frames", -1)) == manifest["video_frames"],
                "Encoded source timing differs from its renderer manifest")
        render[variant], sources[variant], streams[variant] = manifest, source.resolve(), stream

    require(render["baseline"]["playback_timeline"] == render["protected"]["playback_timeline"],
            "Paired recordings have different action timelines")
    duration = float(streams["baseline"]["duration"])
    require(abs(duration - float(streams["protected"]["duration"])) <= .001,
            "Paired recordings have different durations")
    return ExportInputs(report_path, report, case, sources, render, duration,
                        frozen_hashes, evidence)


def make_banner(instruction):
    font_path = next((path for path in FONT_PATHS if path.exists()), None)
    require(font_path is not None, "A readable Arial or DejaVu font is required")

    def font(size):
        return ImageFont.truetype(str(font_path), size)

    banner = Image.new("RGB", (1280, 192), "#09141e")
    draw = ImageDraw.Draw(banner)
    draw.text((20, 14), "ONE REQUEST. SAME ACTIONS. SAPLING CHECKS EXECUTION.",
              font=font(24), fill="#eef5fa")
    draw.text((20, 49), "THE EXACT OPENVLA REQUEST", font=font(14), fill="#a6b9c9")
    lines, line = [], ""
    for word in instruction.split():
        candidate = (line + " " + word).strip()
        if draw.textlength(candidate, font=font(27)) > 1240:
            lines.append(line)
            line = word
        else:
            line = candidate
    lines.append(line)
    require(len(lines) <= 2, "Instruction exceeds the two-line banner")
    for index, line in enumerate(lines):
        draw.text((20, 73 + 31 * index), line, font=font(27), fill="#ffffff")
    draw.text((20, 145),
              "Selected simulation example · Pretrained OpenVLA; unvalidated camera/tool",
              font=font(14), fill="#a6b9c9")
    draw.text((20, 166),
              "Original actions, unscaled · Actual 60fps physics · Sapling checks policy + measured geometry",
              font=font(14), fill="#a6b9c9")
    return banner


def build(report_path, output):
    inputs = load_inputs(report_path)
    output = Path(output).resolve()
    require(output.suffix.lower() == ".mp4", "Output must use the .mp4 extension")
    metadata_path = output.with_suffix(".presentation.json")
    reserved = set(inputs.frozen_hashes)
    for variant in VARIANTS:
        reserved.add((inputs.report_path.parent / f'{inputs.case["id"]}.{variant}.mp4').resolve())
    require(output not in reserved and metadata_path not in reserved,
            "Output must not overwrite a recorded source or provenance artifact")
    require(not output.is_relative_to(inputs.report_path.parent / "source"),
            "Output must not be written into the frozen source archive")
    banner = make_banner(inputs.case["instruction"])
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="knife-demo-", dir=output.parent) as scratch:
        scratch = Path(scratch)
        png, encoded = scratch / "banner.png", scratch / "showcase.mp4"
        banner.save(png)
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(inputs.sources["baseline"]), "-i", str(inputs.sources["protected"]),
            "-framerate", "60", "-loop", "1", "-i", str(png),
            "-filter_complex_threads", "1", "-filter_complex",
            "[0:v][1:v]hstack=inputs=2[pair];[2:v][pair]vstack=inputs=2:shortest=1[v]",
            "-map", "[v]", "-an", "-t", str(inputs.duration), "-r", "60",
            "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "18",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(encoded),
        ], check=True)
        stream = probe(encoded)
        require((stream["width"], stream["height"]) == OUTPUT_SIZE
                and Fraction(stream["r_frame_rate"]) == FPS
                and abs(float(stream["duration"]) - inputs.duration) <= .001,
                "Encoded presentation failed size, frame rate or duration verification")
        for path, expected in inputs.frozen_hashes.items():
            require(sha(path) == expected, f"Input changed while exporting: {path}")
        metadata = {
            "case_id": inputs.case["id"], "instruction": inputs.case["instruction"],
            "report_sha256": inputs.frozen_hashes[inputs.report_path],
            "output_sha256": sha(encoded), "size": list(OUTPUT_SIZE), "fps": FPS,
            "duration_s": inputs.duration, "speed": 1,
            "sources": {
                variant: {
                    "path": str(path), "sha256": inputs.frozen_hashes[path],
                    "renderer_metadata": inputs.render[variant],
                    "video_hash_evidence": inputs.video_hash_evidence[variant],
                }
                for variant, path in inputs.sources.items()
            },
            "display_note": "Actual dense 240Hz physics replay captured every fourth tick; no optical flow, pose interpolation, action scaling or display retiming.",
        }
        temporary_metadata = scratch / "presentation.json"
        temporary_metadata.write_text(json.dumps(metadata, indent=2) + "\n")
        encoded.replace(output)
        temporary_metadata.replace(metadata_path)
    print(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        build(args.report, args.output)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(2, f"knife_demo: {error}\n")


if __name__ == "__main__":
    main()
