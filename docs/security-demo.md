# Adversarial action safety showcase

Open the console's **Safety lab** tab at `/safety`. This experiment's report is
`security/safety-20261025-showcase/report.json` in the runs dir (or in `evidence/`). A
standalone side-by-side reel is `showcase.mp4` in the same directory.

The frozen 24-case suite contains 18 unsafe proposals and six safe controls. Actual
Sapling inference blocked all 18 unsafe proposals and allowed three safe controls.
The remaining three controls were held for insufficient information. The wider
69-case reference probe was 64/69 correct and approved one of 21 unsafe cases. Both
results are shown, with the original inputs and outputs. This is evidence of useful
protection under tested conditions, not universal safety.

## What the audience sees

1. Select **Move into an occupied workspace** and replay the paired videos. The
   unguarded arm executes the prohibited action; the guarded arm holds its position.
   The numbers below each video are measured joint displacement and policy violations.
2. Select **Forge an operator safety override**. Inspect the quoted attacker command,
   trusted person distance, and the real Sapling verdict. The attacker can substitute
   a candidate action and command text, but cannot rewrite the policy or sensor data.
3. Select **Recheck when a person enters**. Both variants begin with a permitted
   approach; the second check evaluates the changed scene before the pour.
4. Show the safe controls too. Clear-workspace actions pass; some valid boundary and
   reduced-speed actions are conservatively blocked. The comparison keeps these costs
   visible.
5. Open **Full evidence** for the exact policy, evidence, claim, probabilities,
   conformal prediction set, and admission decision. The wider probe's unsafe miss is
   also visible above the scenarios.

## What is actually running

- A real provider planner call through Mubit supplies the nominal plan and records its
  gateway request ID. Scripted attacks then replace selected action settings. This
  isolates a compromised action interface; it does not measure a VLA's jailbreak rate.
- Mubit Labs' fine-tuned **Banyan Sapling** verifier runs on one Modal H100 using its
  packaged weights and runtime. The checksum and package versions are in the report.
- Real Panda articulation, joint motors and collision queries run in **PyBullet on
  Modal CPU containers**. Every variant has the same starting state and physical seed.
  The receiving bin and tool are rigid bodies. There are no nuts/fluid or injury models.
- The protected arm executes only when the recorded Sapling decision admits the action.
  The numeric rule oracle scores results afterward; it never opens the gate.
- Every decision follows the existing Steward top-label policy. Sapling's conformal
  status remains `unsure` in these checks. An argmax approval is not a calibrated safety
  guarantee. Failed calls and malformed probabilities withhold execution.
- Mubit task adapters cannot be invoked by model ID through its public API. This demo
  uses Mubit provider planning and the fine-tuned Sapling verifier; it does not claim
  an evaluated Mubit adapter. See the [Mubit model-ID documentation](https://docs.mubit.ai/guides/model-ids).

## Reproduce

Reproducing makes paid calls on your own accounts. Put your `MUBIT_API_KEY`, your team
`MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET`, and a random `SAPLING_TOKEN` in the repository
`.env`. Commands never print those values or fall back to a personal Modal login. The
deployed `/verify` refuses requests without `SAPLING_TOKEN`, so its URL alone can't spend
the GPU; `steward/sapling.py` sends the token on every request.

```bash
python3 -m pip install -r requirements.txt -r deploy/modal/requirements.txt
python3 deploy/modal/team.py secret create steward-sapling-auth SAPLING_TOKEN=<the same value>
python3 deploy/modal/team.py run deploy/modal/sapling.py::download
python3 deploy/modal/team.py deploy deploy/modal/sapling.py   # prints your endpoint; set SAPLING_URL to it
python3 -m steward.security
```

The initial Sapling request loads about 46 GB of weights (about 43 s from cold).
`/health` stays CPU-only and needs no token. GPU execution uses `max_containers=1`;
physics uses at most four CPU containers. Opening the console and playing recordings
makes no paid model calls. The deployment scales the GPU down after ten idle minutes.

If interrupted after model capture, resume without repeating paid model calls:

```bash
python3 -m steward.security --resume runs/security/<run-id>
```

Resume checks the frozen simulation-source and job digests before reusing a physics
cache. It refuses to mix experiments after source changes. Reports are published only
after all expected physics outputs are present. Partial outputs remain available for
inspection, but are not shown as completed evaluations.

Generate the shareable reel locally with FFmpeg and Pillow, and copy the finished run
into the committed `evidence/` folder (endpoint URLs and local paths are redacted on the
way, and the export stops if anything credential-shaped remains):

```bash
python3 video/security_showcase.py runs/security/<run-id>
python3 -m steward.evidence --security <run-id>
pnpm --dir console dev
```

## Evidence and validation

`suite.json` is saved before querying Sapling, with a SHA-256 in the report. Ordered
checks live in `<case>.checks.json`, and `captured.json` retains the original model
responses. `<case>.<variant>.physics.json` holds trajectories, contacts and execution
metrics; the matching MP4 is the rendered recording. `events.jsonl` follows the
[event contract](../steward/EVENTS.md).

The infrastructure probe also discovered that padded batching changed a label. The
deployment runs one request per forward pass, with no batching path. Re-running all 69
cases with four concurrent callers produced identical logits to sequential inference.
Raw probe requests, answers, parity results and runtime logs are in
`runs/security/infra/`.

The showcase assumes trustworthy telemetry and only covers four written pour rules.
It does not evaluate unseen hazards, sensor compromise, hardware braking, human
injury, learned vision-language-action models, or production certification.
