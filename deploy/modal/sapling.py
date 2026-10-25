"""Banyan Sapling on Modal: the same /verify and /health that sapling/serve.py answers on the DGX.

Deploy with the team's Modal token from .env (never a personal Modal login). /verify
requires a bearer token held in the steward-sapling-auth Modal Secret, so the URL alone
can't spend the GPU. Put the same value in .env as SAPLING_TOKEN; steward/sapling.py and
the console send it on every request.
    python3 deploy/modal/team.py secret create steward-sapling-auth SAPLING_TOKEN=<random value>
    python3 deploy/modal/team.py run deploy/modal/sapling.py::download
    python3 deploy/modal/team.py deploy deploy/modal/sapling.py

The weights (46 GB, MubitLabs/banyan-sapling) live in the steward-sapling Volume. One H100
holds them. Loading dominates a cold start, so there is no GPU snapshot (Modal's docs:
snapshots don't speed up loading from storage); instead the container stays warm for
10 minutes after the last check. Inference runs one request per forward pass: on the
69-case probe, padding a batch of two changed one label (runs/security/infra).

/health runs on a CPU container, needs no token, and never wakes the GPU.
"""

import json
import time
from pathlib import Path

import modal

APP = "steward-sapling"
MODEL_DIR = Path("/model")
REPO_ID = "MubitLabs/banyan-sapling"

app = modal.App(APP)
weights = modal.Volume.from_name("steward-sapling", create_if_missing=True)

# The package's pinned runtime (runtime_versions.json), minus the vision packages it doesn't use.
gpu_image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install("torch==2.14.1", "transformers==5.17.0", "tokenizers==0.23.3",
                    "safetensors==0.8.0", "numpy==2.5.4", "accelerate==1.15.0",
                    "huggingface-hub==1.33.0")
    .env({"CUBLAS_WORKSPACE_CONFIG": ":4096:8"})
)
download_image = modal.Image.debian_slim(python_version="3.12").uv_pip_install("huggingface_hub[hf_xet]==1.33.0")
web_image = modal.Image.debian_slim(python_version="3.12").uv_pip_install("fastapi[standard]")


@app.function(image=download_image, volumes={str(MODEL_DIR): weights}, timeout=3600, cpu=8, memory=16384)
def download():
    from huggingface_hub import snapshot_download

    start = time.perf_counter()
    snapshot_download(REPO_ID, local_dir=str(MODEL_DIR), max_workers=16)
    weights.commit()
    size = sum(p.stat().st_size for p in MODEL_DIR.rglob("*") if p.is_file())
    print(f"{REPO_ID}: {size / 1e9:.1f} GB in {time.perf_counter() - start:.0f} s")


@app.cls(gpu="H100", image=gpu_image, volumes={str(MODEL_DIR): weights}, timeout=3600,
         scaledown_window=600, max_containers=1)
class Sapling:
    @modal.enter()
    def load(self):
        import sys

        sys.path.insert(0, str(MODEL_DIR))
        from handler import load_model_for_endpoint

        start = time.perf_counter()
        self.model, self.tokenizer, self.calibrator, self.manifest = load_model_for_endpoint(MODEL_DIR)
        print(f"Loaded in {time.perf_counter() - start:.0f} s", flush=True)
        example = json.loads((MODEL_DIR / "examples/policy_claim.json").read_text())
        self._forward([example])  # the first forward compiles the kernels

    def _forward(self, requests):
        import torch
        from runtime.backbone import encode
        from runtime.model import collate

        rows = [encode(self.tokenizer, {k: r[k] for k in ("policy", "evidence", "claim")}, 16384)
                for r in requests]
        pad = self.tokenizer.pad_token_id if self.tokenizer.pad_token_id is not None else self.tokenizer.eos_token_id
        with torch.inference_mode():
            logits = self.model(**collate(rows, pad, "cuda")).float().cpu()
        if not torch.isfinite(logits).all():
            raise RuntimeError("Nonfinite inference")
        return list(logits)

    def _answer(self, logits, ms, request):
        import torch
        from runtime.backbone import encode

        detail = self.calibrator.predict_detailed(logits.reshape(1, 4), empty_set_policy="rounded_argmax")[0]
        probabilities = torch.softmax(logits.double() / self.calibrator.temperature, -1).tolist()
        return {"model": "banyan-sapling", "release_stage": "research-preview",
                "source_release_sha256": self.manifest.get("source_release_sha256", ""),
                "weights_sha256": self.manifest.get("files", {}).get("model.safetensors", ""),
                "logits": logits.tolist(), **detail,
                "probabilities": dict(zip(self.calibrator.LABELS, probabilities)),
                "usage": {"input_tokens": len(encode(self.tokenizer, request, 16384)["input_ids"]),
                          "generated_tokens": 0},
                "timing_ms": {"model": ms}}

    @modal.method()
    def check(self, request: dict) -> dict:
        start = time.perf_counter()
        [logits] = self._forward([request])
        return self._answer(logits, (time.perf_counter() - start) * 1000, request)


@app.function(image=web_image, volumes={str(MODEL_DIR): weights}, scaledown_window=600,
              secrets=[modal.Secret.from_name("steward-sapling-auth")])
@modal.concurrent(max_inputs=64)
@modal.asgi_app(label="steward-sapling")
def web():
    import hmac
    import os

    from fastapi import FastAPI, Header, HTTPException

    api = FastAPI()
    token = os.environ.get("SAPLING_TOKEN", "")
    manifest_path = MODEL_DIR / "distribution_manifest.json"
    sha = json.loads(manifest_path.read_text()).get("files", {}).get("model.safetensors", "") \
        if manifest_path.exists() else ""

    @api.get("/health")
    def health():
        return {"ok": True, "model": "banyan-sapling", "weights_sha256": sha, "where": "modal"}

    @api.post("/verify")
    async def verify(body: dict, authorization: str = Header(default="")):
        # Fail closed: with no token configured, nobody can reach the GPU.
        if not token or not hmac.compare_digest(authorization, f"Bearer {token}"):
            raise HTTPException(401, "missing or wrong bearer token")
        if not all(isinstance(body.get(k), str) and body[k].strip() for k in ("policy", "evidence", "claim")):
            raise HTTPException(400, "policy, evidence and claim must be nonempty strings")
        return await Sapling().check.remote.aio({k: body[k] for k in ("policy", "evidence", "claim")})

    return api
