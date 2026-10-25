"""Package real paired recordings into a standalone, captioned comparison reel.

    python3 video/security_showcase.py runs/security/<run_id>

Requires ffmpeg and Pillow. Makes no model calls; all numbers come from report.json.
"""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    report = json.loads((directory / "report.json").read_text())
    if report["mode"] != "live":
        raise SystemExit("A completed live report is required.")
    knife = report.get("task") == "knife-handover"
    width, height = (3840, 1240) if knife else (2560, 880)
    font_path = next((p for p in (Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
                                  Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")) if p.exists()), None)

    def font(size):
        return ImageFont.truetype(str(font_path), size) if font_path else ImageFont.load_default()

    def ffmpeg(*parts):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *map(str, parts)], check=True)

    with tempfile.TemporaryDirectory(prefix="steward-reel-") as scratch:
        scratch = Path(scratch)
        segments = []

        def card(name, heading, lines, seconds=4):
            canvas = Image.new("RGB", (width, height), "#0a1018")
            draw = ImageDraw.Draw(canvas)
            draw.rectangle((0, 0, width, 8), fill="#5cc491")
            draw.text((100, 90), "STEWARD  /  MODAL SIMULATION", font=font(34), fill="#9aa0a7")
            draw.text((100, 190), heading, font=font(74), fill="#edefec")
            for i, (text, color) in enumerate(lines):
                draw.text((100, 335 + i * 84), text, font=font(40), fill=color)
            image_path, video_path = scratch / f"{name}.png", scratch / f"{name}.mp4"
            canvas.save(image_path)
            ffmpeg("-loop", "1", "-i", image_path, "-t", seconds, "-r", 20, "-c:v", "libx264",
                   "-preset", "fast", "-crf", 19, "-pix_fmt", "yuv420p", video_path)
            segments.append(video_path)

        card("intro", "OpenVLA proposes. Sapling checks." if knife else "One compromised action. Two outcomes.", [
            ("LEFT   OpenVLA camera-and-language actions reach the robot." if knife else "LEFT   Unguarded candidate action reaches the robot.", "#f29a65"),
            ("RIGHT   Banyan Sapling checks the same action before execution.", "#5cc491"),
            ("Human-eye + side cameras. Actual model deltas, without amplification." if knife else "Live model inference + measured articulated robot physics on Modal.", "#edefec"),
            ("Pretrained OpenVLA under simulator domain shift; no injury or universal-safety claim." if knife else "Scripted action attacks; no learned VLA or Mubit adapter evaluated.", "#9aa0a7"),
        ])
        selected = report["cases"] if knife else [c for c in report["cases"] if c["split"] == "showcase"]
        if knife and report.get("featured_case_id"):
            selected = sorted(selected, key=lambda c: c["id"] != report["featured_case_id"])
        if not knife:
            selected += [c for c in report["cases"] if c["id"] in ("safe-approach", "safe-slow")]
        for index, case in enumerate(selected):
            banner = Image.new("RGB", (width, 160), "#0a1018")
            draw = ImageDraw.Draw(banner)
            draw.text((35, 22), f"{index+1:02}  {case['title']}", font=font(45), fill="#edefec")
            is_safe = case["expected_safe"]
            suffix = "Safe control" if is_safe else "Adversarial proposal"
            statuses = " / ".join(s["decision"]["label"] for s in case["steps"])
            second = "VLA instruction: " + case["instruction"] if knife else f"{suffix}    |    Sapling: {statuses}"
            draw.text((35, 88), second, font=font(32), fill="#9aa0a7")
            banner_path = scratch / f"banner-{index}.png"
            banner.save(banner_path)
            output = scratch / f"pair-{index}.mp4"
            base = directory / case["videos"]["baseline"]
            protected = directory / case["videos"]["protected"]
            ffmpeg("-i", base, "-i", protected, "-loop", "1", "-i", banner_path,
                   "-filter_complex", "[0:v][1:v]hstack=inputs=2[pair];[2:v][pair]vstack=inputs=2,"
                   "tpad=stop_mode=clone:stop_duration=1.5[v]", "-map", "[v]", "-t",
                   case["baseline"]["metrics"]["video_frames"] / case["baseline"].get("fps", 20) + 1.5,
                   "-r", 20, "-c:v", "libx264", "-preset", "fast", "-crf", 19, "-pix_fmt", "yuv420p", output)
            segments.append(output)
        summary = report["summary"]
        probe = report.get("validation", {}).get("reference_probe", {})
        card("results", "Protection measured. Limits kept visible.", [
            ((f"{summary['unsafe_proposals']-summary['unsafe_proposals_allowed']}/{summary['unsafe_proposals']} unsafe proposals blocked; "
              f"{summary['safe_proposals_allowed']}/{summary['safe_proposals']} safe proposals approved.") if knife else
             (f"Showcase: {summary['unsafe_blocked']}/{summary['unsafe_cases']} unsafe scenarios blocked; "
              f"{summary['safe_allowed']}/{summary['safe_controls']} safe controls allowed."), "#5cc491"),
            ((f"Safe episodes fully approved: {summary['safe_allowed']}/{summary['safe_controls']}. An earlier block keeps the episode held.") if knife else
             f"Wider probe: {probe.get('unsafe_approved', '?')}/{probe.get('unsafe_cases', '?')} unsafe approvals.", "#f29a65"),
            ((f"Knife policy probe: {probe.get('correct', '?')}/{probe.get('cases', '?')} correct; {probe.get('unsafe_approved', '?')}/{probe.get('unsafe_cases', '?')} unsafe approvals. No injury claim.") if knife else
             "Policy violations and motor motion measured; no injury claim.", "#edefec"),
            ("Pretrained VLA under domain shift. Accurate telemetry assumed. Universal safety not established." if knife else
             "Finite written rules. Accurate telemetry assumed. Universal safety not established.", "#9aa0a7"),
        ], seconds=5)
        manifest = scratch / "segments.txt"
        manifest.write_text("".join(f"file '{p}'\n" for p in segments))
        target = directory / "showcase.mp4"
        ffmpeg("-f", "concat", "-safe", 0, "-i", manifest, "-c", "copy", "-movflags", "+faststart", target)
        print(target)


if __name__ == "__main__":
    main()
