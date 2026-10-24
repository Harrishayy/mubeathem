"""Make each recorded take playable in the player: a smoothed copy of its video,
and runs/web/takes.json listing the takes.

    python3 video/prepare.py

Isaac records 50 fps (older takes: 20 fps). ffmpeg's motion interpolation doubles that,
so the player's slow motion stays smooth, without moving any frame in time, so the log
stays in sync.
"""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAKES = ROOT / "runs/takes"
WEB = ROOT / "runs/web"


def story(events):
    results = [e for e in events if e["kind"] == "result"]
    return " → ".join("lands" if e["success"] else "spills" for e in results) or "no result"


def frame_info(path):
    data = json.loads(path.read_text())
    return (20, data) if isinstance(data, list) else (data["fps"], data["times"])


def smooth(src, dst, fps):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src),
                    "-vf", f"minterpolate=fps={max(60, fps * 2)}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-g", "30",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(dst)], check=True)


def main():
    WEB.mkdir(parents=True, exist_ok=True)
    listed = []
    for log in sorted(TAKES.glob("*.jsonl"), reverse=True):
        video, frames = log.with_suffix(".mp4"), log.with_suffix(".frames.json")
        if not (video.exists() and frames.exists()):
            continue
        fps, _ = frame_info(frames)
        out = WEB / video.name
        if not out.exists() or out.stat().st_mtime < video.stat().st_mtime:
            print(f"smoothing {video.name}", flush=True)
            smooth(video, out, fps)
        events = [json.loads(line) for line in log.read_text().splitlines() if line.strip()]
        listed.append({
            "take": log.stem,
            "story": story(events),
            "fps": fps,
            "video": f"../runs/web/{out.name}",
            "log": f"../runs/takes/{log.name}",
            "frames": f"../runs/takes/{frames.name}",
        })
    (WEB / "takes.json").write_text(json.dumps(listed, indent=2))
    for take in listed:
        print(f"{take['take']}: {take['story']}")


if __name__ == "__main__":
    main()
