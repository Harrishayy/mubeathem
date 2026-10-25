# Evidence

Real recordings, committed so the console shows them on a fresh clone. It has the same
layout as `runs/`, and the console reads it whenever `runs/` holds no take or safety report:

| Path | What it is |
|---|---|
| `takes/<take>.jsonl`, `.lessons.json`, `.frames.json`, `.mp4`, `.pov.mp4` | An Isaac take: every event ([`steward/EVENTS.md`](../steward/EVENTS.md)), its lessons and its video |
| `web/<take>.mp4` | The take's player copy, from `video/prepare.py` |
| `security/<run>/` | A completed Safety lab run: `report.json`, the paired recordings and every check |

Nothing here is written by hand or by a stand-in. Add runs only with the exporter, from
the originals in `runs/`:

```bash
python3 -m steward.evidence --take robot-A-20261024-153012 --security safety-20261025-showcase
python3 -m steward.evidence --check
```

It refuses offline and fixture takes, and runs without a completed live report. It
redacts endpoint URLs and this machine's paths from every text file, and stops if
anything credential-shaped remains. The console never writes here: lessons added while
it shows this folder are refused. To reproduce or resume a run, use the originals in
`runs/`. Redaction changes these copies' bytes, so their recorded hashes no longer match.
