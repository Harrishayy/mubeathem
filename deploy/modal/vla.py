"""Pinned OpenVLA image-and-language inference for simulated robot action proposals.

Use the repository team credentials, never a personal Modal profile:
    python3 deploy/modal/team.py run deploy/modal/vla.py::download
    python3 deploy/modal/team.py deploy deploy/modal/vla.py
    python3 deploy/modal/team.py run deploy/modal/vla.py --jobs jobs.json --output runs/knife/vla

Jobs are [{"id": "case", "image_path": "/absolute/camera.png", "instruction": "..."}].
The local entrypoint calls the deployed class, so successive jobs reuse one GPU.
The model's official predict_action method generates and decodes every action; no
scripted action is substituted. Choosing a Franka dataset's statistics does not
validate transfer to a new simulator, camera, task or attached tool.
"""

import hashlib
import io
import json
from pathlib import Path
import time

import modal

APP = "steward-openvla"
REPO_ID = "openvla/openvla-7b"
REVISION = "47a0ec7fc4ec123775a391911046cf33cf9ed83f"
MODEL_DIR = Path("/model/openvla")
DEFAULT_STATS = "nyu_franka_play_dataset_converted_externally_to_rlds"
LIMITATIONS = [
    "Pretrained OpenVLA; not fine-tuned or validated for this PyBullet scene, camera, tool or task.",
    "Dataset unnormalization supplies Franka action statistics; it does not establish simulator control compatibility.",
    "Each result is one generated seven-dimensional proposal, not evidence of successful task completion.",
]

app = modal.App(APP)
weights = modal.Volume.from_name("steward-openvla", create_if_missing=True)
download_image = modal.Image.debian_slim(python_version="3.10").uv_pip_install(
    "huggingface-hub[hf_xet]==0.36.0"
)
image = modal.Image.debian_slim(python_version="3.10").uv_pip_install(
    "torch==2.2.0", "torchvision==0.17.0", "transformers==4.40.1",
    "tokenizers==0.19.1", "timm==0.9.10", "accelerate==0.30.1",
    "numpy==1.26.4", "Pillow==10.4.0", "sentencepiece==0.2.0",
    "huggingface-hub==0.26.5", "protobuf==4.25.3",
)


@app.function(image=download_image, volumes={"/model": weights}, cpu=4,
              memory=8192, timeout=1800, max_containers=1, scaledown_window=30)
def download():
    from huggingface_hub import snapshot_download

    started = time.perf_counter()
    snapshot_download(REPO_ID, revision=REVISION, local_dir=str(MODEL_DIR), max_workers=8)
    manifest = {"model": REPO_ID, "revision": REVISION,
                "bytes": sum(p.stat().st_size for p in MODEL_DIR.rglob("*") if p.is_file()),
                "download_seconds": time.perf_counter() - started}
    (MODEL_DIR / "modal_download.json").write_text(json.dumps(manifest, indent=2) + "\n")
    weights.commit()
    print(json.dumps(manifest), flush=True)
    return manifest


@app.cls(image=image, gpu="H100", volumes={"/model": weights}, cpu=4, memory=24576,
         max_containers=1, scaledown_window=120, timeout=600)
class VLA:
    @modal.enter()
    def load(self):
        import importlib.metadata
        import torch
        from transformers import AutoModelForVision2Seq, AutoProcessor

        started = time.perf_counter()
        manifest = json.loads((MODEL_DIR / "modal_download.json").read_text())
        if manifest["revision"] != REVISION:
            raise RuntimeError("OpenVLA volume revision differs from the pinned service")
        torch.manual_seed(1707)
        self.processor = AutoProcessor.from_pretrained(
            str(MODEL_DIR), trust_remote_code=True, local_files_only=True
        )
        self.model = AutoModelForVision2Seq.from_pretrained(
            str(MODEL_DIR), trust_remote_code=True, local_files_only=True,
            attn_implementation="eager", torch_dtype=torch.bfloat16,
            low_cpu_mem_usage=True,
        ).to("cuda:0").eval()
        self.runtime = {"gpu": torch.cuda.get_device_name(), "cuda": torch.version.cuda,
                        "packages": {key: importlib.metadata.version(key) for key in (
                            "torch", "torchvision", "transformers", "tokenizers", "timm",
                            "accelerate", "numpy", "Pillow", "huggingface-hub")}}
        self.cold_load_seconds = time.perf_counter() - started
        print(json.dumps({"loaded": REPO_ID, "revision": REVISION,
                          "cold_load_seconds": self.cold_load_seconds,
                          "runtime": self.runtime, "stats_keys": list(self.model.norm_stats)}), flush=True)

    @modal.method()
    def predict(self, image_png: bytes, instruction: str, unnorm_key: str | None = None) -> dict:
        import numpy as np
        import torch
        from PIL import Image

        if not isinstance(instruction, str) or not instruction.strip():
            raise ValueError("instruction must be a nonempty string")
        if len(instruction) > 4000:
            raise ValueError("instruction exceeds the inference service limit")
        if not isinstance(image_png, bytes) or len(image_png) > 16 * 1024 * 1024:
            raise ValueError("image must be encoded bytes of at most 16 MiB")
        key = unnorm_key or DEFAULT_STATS
        if key not in self.model.norm_stats:
            raise ValueError(f"Unknown normalization key {key!r}; available: {list(self.model.norm_stats)}")
        started = time.perf_counter()
        source = Image.open(io.BytesIO(image_png))
        source.load()
        camera = source.convert("RGB")
        prompt = f"In: What action should the robot take to {instruction.strip().lower()}?\nOut:"
        inputs = self.processor(prompt, camera).to("cuda:0", dtype=torch.bfloat16)
        # The upstream predict_action appends this training delimiter to IDs only.
        # Align the single-example attention mask as well; eager attention rejects
        # its otherwise-one-token-short mask. No image/action values are changed.
        if inputs["input_ids"][0, -1].item() != 29871:
            inputs["input_ids"] = torch.cat((inputs["input_ids"], torch.full(
                (1, 1), 29871, dtype=inputs["input_ids"].dtype, device="cuda:0")), dim=1)
            if "attention_mask" in inputs:
                inputs["attention_mask"] = torch.cat((inputs["attention_mask"], torch.ones(
                    (1, 1), dtype=inputs["attention_mask"].dtype, device="cuda:0")), dim=1)
        # Observe the real generated IDs without changing predict_action or its decoder.
        original_generate = self.model.generate
        generated = {}

        def record_generate(*args, **kwargs):
            tokens = original_generate(*args, **kwargs)
            ids = args[0] if args else kwargs["input_ids"]
            generated["input_token_ids"] = ids[0].detach().cpu().tolist()
            generated["generation_token_ids"] = tokens[0, ids.shape[1]:].detach().cpu().tolist()
            generated["action_token_ids"] = tokens[0, -self.model.get_action_dim(key):].detach().cpu().tolist()
            return tokens

        self.model.generate = record_generate
        try:
            torch.cuda.synchronize()
            model_started = time.perf_counter()
            with torch.inference_mode():
                action = self.model.predict_action(**inputs, unnorm_key=key, do_sample=False)
            torch.cuda.synchronize()
            model_ms = (time.perf_counter() - model_started) * 1000
        finally:
            self.model.generate = original_generate
        if np.shape(action) != (7,) or not np.isfinite(action).all():
            raise RuntimeError("OpenVLA did not produce seven finite action values")
        action_tokens_valid = len(generated["generation_token_ids"]) == 7 and all(
            self.model.vocab_size - self.model.config.n_action_bins <= token < self.model.vocab_size
            for token in generated["action_token_ids"])
        pixels = inputs["pixel_values"].detach().contiguous().view(torch.uint8).cpu().numpy().tobytes()
        return {"model": REPO_ID, "revision": REVISION, "stats_key": key,
                "instruction": instruction, "prompt": prompt, "action7": action.tolist(),
                "action_order": ["delta_x", "delta_y", "delta_z", "delta_roll", "delta_pitch", "delta_yaw", "gripper"],
                "action_stats": self.model.get_action_stats(key),
                "input_sha256": hashlib.sha256(image_png).hexdigest(),
                "image_rgb_sha256": hashlib.sha256(camera.tobytes()).hexdigest(),
                "processed_pixels_sha256": hashlib.sha256(pixels).hexdigest(),
                "image_size": list(camera.size), "processed_image_shape": list(inputs["pixel_values"].shape),
                **generated, "generated_tokens": len(generated["generation_token_ids"]),
                "generation_is_action_tokens": action_tokens_valid,
                "timing_ms": {"model": model_ms, "total": (time.perf_counter() - started) * 1000},
                "cold_load_seconds": self.cold_load_seconds, "runtime": self.runtime,
                "limitations": LIMITATIONS, "do_sample": False}


@app.local_entrypoint()
def main(jobs: str, output: str):
    import re

    job_path = Path(jobs).resolve()
    entries = json.loads(job_path.read_text())
    if not isinstance(entries, list) or not entries:
        raise ValueError("jobs must be a nonempty JSON list")
    destination = Path(output).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    worker = modal.Cls.from_name(APP, "VLA")()
    calls = []
    ids = set()
    for job in entries:
        id = job["id"]
        if not isinstance(id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,159}", id) or id in ids:
            raise ValueError("Job ids must be unique safe filenames")
        ids.add(id)
        camera_path = Path(job["image_path"])
        if not camera_path.is_absolute():
            camera_path = job_path.parent / camera_path
        started = time.perf_counter()
        answer = worker.predict.remote(camera_path.read_bytes(), job["instruction"], job.get("unnorm_key"))
        record = {"id": id, "image_path": str(camera_path.resolve()),
                  "instruction": job["instruction"], "got": answer,
                  "http_or_rpc_wall_ms": (time.perf_counter() - started) * 1000}
        (destination / f"{id}.vla.json").write_text(json.dumps(record, indent=2, allow_nan=False) + "\n")
        calls.append(record)
        (destination / "calls.json").write_text(json.dumps(calls, indent=2, allow_nan=False) + "\n")
        print(json.dumps({"id": id, "action7": answer["action7"], "model_ms": answer["timing_ms"]["model"]}), flush=True)
