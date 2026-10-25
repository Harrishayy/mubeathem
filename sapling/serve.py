"""Serve Banyan Sapling on the DGX, so the loop's safety checks can call it.

Run it with the Sapling environment's Python (not Isaac's), from anywhere:
    ~/steward/sapling/.venv/bin/python ~/steward/repo/sapling/serve.py --model-dir ~/steward/sapling/model

POST /verify with {"policy", "evidence", "claim"} returns Sapling's own answer: status
(one of the four labels, or unsure), raw_label, prediction_set and calibrated
probabilities. GET /health says it is up. The model (about 46 GB) loads once with the
loader shipped in the weights package and answers one request at a time.

With SAPLING_TOKEN set (or --token), /verify answers only requests that send it as
"Authorization: Bearer <token>", which steward/sapling.py does. Without one, it answers
anyone who can reach it, so keep it on 127.0.0.1 behind an SSH tunnel.
"""

import argparse
import hmac
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FIELDS = ("policy", "evidence", "claim")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--model-dir", type=Path, default=Path.home() / "steward/sapling/model")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--token", default=os.environ.get("SAPLING_TOKEN"),
                        help="Require this bearer token on /verify (default: SAPLING_TOKEN).")
    args = parser.parse_args()
    expected = f"Bearer {args.token}" if args.token else None

    # The package's own serving loader: the reference inference.py loader, minus its exact
    # version pins and the 46 GB re-hash (run `inference.py --check-files` once instead).
    sys.path.insert(0, str(args.model_dir.resolve()))
    from handler import load_model_for_endpoint, predict_for_endpoint

    start = time.perf_counter()
    model, tokenizer, calibrator, manifest = load_model_for_endpoint(args.model_dir)
    example = json.loads((args.model_dir / "examples/policy_claim.json").read_text())
    warm = predict_for_endpoint(model, tokenizer, calibrator, manifest, example)  # first call compiles kernels
    print(f"Loaded in {time.perf_counter() - start:.0f} s; example → {warm['status']}", flush=True)
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def send(self, code, data):
            body = json.dumps(data).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path != "/health":
                return self.send(404, {"error": "not found"})
            self.send(200, {"ok": True, "model": "banyan-sapling",
                            "weights_sha256": manifest.get("files", {}).get("model.safetensors", "")})

        def do_POST(self):
            if self.path != "/verify":
                return self.send(404, {"error": "not found"})
            if expected and not hmac.compare_digest(self.headers.get("Authorization", ""), expected):
                return self.send(401, {"error": "missing or wrong bearer token"})
            try:
                request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            except ValueError:
                return self.send(400, {"error": "body must be JSON"})
            if not all(isinstance(request.get(k), str) and request[k].strip() for k in FIELDS):
                return self.send(400, {"error": "policy, evidence and claim must be nonempty strings"})
            with lock:
                out = predict_for_endpoint(model, tokenizer, calibrator, manifest, {k: request[k] for k in FIELDS})
            self.send(200, out)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Sapling on http://{args.host}:{args.port}/verify", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
