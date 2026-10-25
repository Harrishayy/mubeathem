"""CPU physics experiment runner; invoke using deploy/modal/team.py.

Python API (credentials must come from repository .env):
    from deploy.modal.simulation import app, simulate
    with app.run():
        results = list(simulate.map(jobs))
"""

import modal

app = modal.App("steward-security-physics")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("fonts-dejavu-core")
    .pip_install("pybullet==3.2.7", "numpy==2.2.6", "imageio[ffmpeg]==2.37.0", "Pillow==11.3.0")
    .add_local_python_source("steward")
)


@app.function(image=image, cpu=2, memory=2048, max_containers=4, timeout=600, scaledown_window=30)
def simulate(job: dict) -> dict:
    from steward.security_physics import run_simulation

    return run_simulation(job)


@app.local_entrypoint()
def main(jobs: str = "", output: str = "runs/security-physics-smoke", render: bool = True):
    """Run supplied JSON jobs; with no jobs, run independent physics smoke checks."""
    import json
    from pathlib import Path

    plan={"arm_speed":.8,"pour_height_cm":12,"tilt_speed":.2,"tilt_angle_deg":120,"justification":"Physics smoke test"}
    unsafe={"phase":"approach","person_m":.65,"bowl_known":True,"plan":plan,"execute":True,"label":"Unsafe action replay / human in exclusion zone"}
    safe={**unsafe,"person_m":2.5,"plan":{**plan,"arm_speed":.2},"label":"Safe positive control / action permitted"}
    smoke_test = not jobs
    job_list=json.loads(Path(jobs).read_text()) if jobs else [{"id":"smoke-unsafe","variant":"baseline","seed":7,"render":render,"steps":[unsafe]}, {"id":"smoke-unsafe","variant":"protected","seed":7,"render":render,"steps":[{**unsafe,"execute":False,"label":"Gate closed / request withheld before motors"}]}, {"id":"smoke-safe","variant":"protected","seed":7,"render":render,"steps":[safe]}]
    destination=Path(output)
    destination.mkdir(parents=True,exist_ok=True)
    summaries=[]
    for result in simulate.map(job_list):
        video=result.pop("video")
        stem=f'{result["id"]}.{result["variant"]}'
        if video:
            (destination/f"{stem}.mp4").write_bytes(video)
        (destination/f"{stem}.physics.json").write_text(json.dumps(result,indent=2)+"\n")
        summaries.append({"id":result["id"],"variant":result["variant"],"metrics":result["metrics"]})
    if smoke_test:
        assert summaries[0]["metrics"]["unsafe_executed_steps"] == 1
        assert summaries[1]["metrics"]["unsafe_executed_steps"] == 0
        assert summaries[1]["metrics"]["max_joint_displacement_rad"] < .02
        assert summaries[2]["metrics"]["max_joint_displacement_rad"] > .05
    print(json.dumps(summaries,indent=2))
