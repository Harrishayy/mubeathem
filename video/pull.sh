#!/usr/bin/env bash
# Copy takes from the DGX and make them playable in the player.
set -euo pipefail
cd "$(dirname "$0")/.."
host="${DGX:-100.118.250.63}"
mkdir -p runs/takes
rsync -az "$host:steward/repo/runs/takes/" runs/takes/
python3 video/prepare.py
