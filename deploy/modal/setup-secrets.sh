#!/usr/bin/env bash
# Pushes the keys in .env to Modal, sets a fresh server token, writes the gitignored local configs
# (.env.modal, apps/brief/config.js, apps/brief/cue.config.js) and redeploys.
# Runs on the Modal workspace in .env (MODAL_TOKEN_ID/SECRET), not your own CLI login. Prints no secrets.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a
# shellcheck disable=SC1091
. ./.env
set +a
for k in MODAL_TOKEN_ID MODAL_TOKEN_SECRET MUBIT_API_KEY DEEPGRAM_API_KEY; do
  [ -n "${!k:-}" ] || { echo "missing $k in .env" >&2; exit 1; }
done

keys=(MUBIT_API_KEY="$MUBIT_API_KEY" DEEPGRAM_API_KEY="$DEEPGRAM_API_KEY")
[ -n "${TRELLUS_API_KEY:-}" ] && keys+=(TRELLUS_API_KEY="$TRELLUS_API_KEY")
[ -n "${EXA_API_KEY:-}" ] && keys+=(EXA_API_KEY="$EXA_API_KEY")
modal secret create corgi-cue-keys "${keys[@]}" --force >/dev/null
echo "corgi-cue-keys: ${#keys[@]} keys set"

TOKEN=$(openssl rand -hex 24)
modal secret create corgi-cue-token CUE_API_TOKEN="$TOKEN" --force >/dev/null
echo "corgi-cue-token: new token set"

URL="https://${MODAL_WORKSPACE:-nicholastchakov}--corgi-cue-live-serve.eu-west.modal.run"
printf 'CUE_API_TOKEN=%s\nCUE_URL=%s\n' "$TOKEN" "$URL" > .env.modal
sed "s|const CUE_SERVER = .*|const CUE_SERVER = '$URL';|; s|const CUE_TOKEN = .*|const CUE_TOKEN = '$TOKEN';|" apps/brief/cue.config.example.js > apps/brief/cue.config.js
sed "s|const DEFAULT_EXA_KEY = .*|const DEFAULT_EXA_KEY = '${EXA_API_KEY:-}';|" apps/brief/config.example.js > apps/brief/config.js
echo "wrote .env.modal, apps/brief/cue.config.js, apps/brief/config.js"

modal deploy deploy/modal/app.py
