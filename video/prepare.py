"""Make each recorded take playable in the player: a smoothed copy of its video,
and runs/web/takes.json listing the takes.

    python3 video/prepare.py

Isaac records two views at 50 fps: the wide shot and the robot's head camera, which goes
in as an inset. Older 20 fps takes get ffmpeg's motion interpolation instead, which adds
frames without moving any in time, so the log stays in sync.
"""

import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = Path(os.environ.get("STEWARD_RUNS_DIR", ROOT / "runs"))  # as steward/config.py reads it
TAKES = RUNS / "takes"
WEB = RUNS / "web"


def story(events):
    results = [e for e in events if e["kind"] == "result"]
    return " → ".join("lands" if e["success"] else "spills" for e in results) or "no result"


def frame_info(path):
    data = json.loads(path.read_text())
    return (20, data) if isinstance(data, list) else (data["fps"], data["times"])


def build(video, pov, dst, fps):
    """A seekable copy for the player: the head camera inset bottom-right when the take has
    one, and old 20 fps takes interpolated so slow motion stays smooth."""
    inputs, filters = ["-i", str(video)], []
    if pov.exists():
        inputs += ["-i", str(pov)]
        filters = ["-filter_complex",
                   "[1:v]scale=768:-2,pad=iw+6:ih+6:3:3:color=white[p];[0:v][p]overlay=W-w-28:H-h-28"]
    elif fps < 50:
        filters = ["-vf", f"minterpolate=fps={max(60, fps * 2)}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, *filters, "-c:v", "libx264", "-preset", "fast",
                    "-crf", "18", "-g", str(max(30, fps)), "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                    str(dst)], check=True)


def main():
    WEB.mkdir(parents=True, exist_ok=True)
    listed = []
    for log in sorted(TAKES.glob("*.jsonl"), reverse=True):
        video, frames = log.with_suffix(".mp4"), log.with_suffix(".frames.json")
        if not (video.exists() and frames.exists()):
            continue
        fps, _ = frame_info(frames)
        pov = log.with_suffix(".pov.mp4")
        out = WEB / video.name
        if not out.exists() or out.stat().st_mtime < video.stat().st_mtime:
            print(f"preparing {video.name}", flush=True)
            build(video, pov, out, fps)
        events = [json.loads(line) for line in log.read_text().splitlines() if line.strip()]
        listed.append({
            "take": log.stem,
            "story": story(events),
            "fps": fps,
            "pov": pov.exists(),
            "video": f"../runs/web/{out.name}",
            "log": f"../runs/takes/{log.name}",
            "frames": f"../runs/takes/{frames.name}",
        })
    (WEB / "takes.json").write_text(json.dumps(listed, indent=2))
    for take in listed:
        print(f"{take['take']}: {take['story']}")


if __name__ == "__main__":
    main()
