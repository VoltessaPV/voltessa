#!/usr/bin/env bash
# Continuous Retraining Loop milestone. Production entry point for
# voltessa-ml-retrain.timer (Scaleway VM). Deployed alongside train.py to
# /opt/voltessa-ml-retrain/ — NOT part of the pnpm monorepo, mirrors the
# existing automation/onnx-inference "standalone deployed directory"
# pattern. Owns the two HTTP hops to Vercel (which already has this app's
# full Prisma/Next.js dependency tree) around the one step that must run
# locally: `python3 train.py`, CPU-bound and Python-only, the same reason
# ONNX inference itself already runs on this VM instead of Vercel.
#
# Requires CRON_SECRET in the environment (systemd EnvironmentFile, same
# convention as every other Voltessa timer on this VM) and a Python venv
# at ./venv with ml-forecasting/requirements.txt installed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/data"
APP_BASE_URL="${VOLTESSA_APP_BASE_URL:-https://app.voltessa.ai}"

mkdir -p "$DATA_DIR"
rm -f "$DATA_DIR/training-dataset.json" "$DATA_DIR/model-manifest.json" "$DATA_DIR/magnitude_model.onnx" "$DATA_DIR/shape_model.onnx"

echo "[ml-retrain] Checking eligibility (and exporting the training dataset if eligible)..."
HTTP_STATUS=$(curl --fail --silent --show-error \
  --connect-timeout 10 --max-time 300 \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -o "$DATA_DIR/export-response.json" \
  -w "%{http_code}" \
  "$APP_BASE_URL/api/internal/forecast/ml-retrain-export")

if [ "$HTTP_STATUS" != "200" ]; then
  echo "[ml-retrain] ml-retrain-export returned HTTP $HTTP_STATUS - aborting." >&2
  cat "$DATA_DIR/export-response.json" >&2
  exit 1
fi

ELIGIBLE=$(python3 -c "import json; print(json.load(open('$DATA_DIR/export-response.json')).get('eligible', False))")

if [ "$ELIGIBLE" != "True" ]; then
  echo "[ml-retrain] Not enough new genuine vintage data this cycle - nothing to do."
  rm -f "$DATA_DIR/export-response.json"
  exit 0
fi

echo "[ml-retrain] Eligible - writing training-dataset.json and training..."
python3 -c "
import json
with open('$DATA_DIR/export-response.json') as f:
    payload = json.load(f)
with open('$DATA_DIR/training-dataset.json', 'w') as f:
    json.dump(payload['dataset'], f)
"
rm -f "$DATA_DIR/export-response.json"

source "$SCRIPT_DIR/venv/bin/activate"
cd "$SCRIPT_DIR"
python3 train.py

echo "[ml-retrain] Registering candidate and evaluating the promotion gate..."
python3 - "$APP_BASE_URL" <<'PYEOF'
import base64
import json
import os
import sys
import urllib.request

app_base_url = sys.argv[1]
# Still cd'd into SCRIPT_DIR from the `cd "$SCRIPT_DIR"` above train.py's own invocation.
DATA_DIR = os.path.join(os.getcwd(), "data")

with open(os.path.join(DATA_DIR, "model-manifest.json")) as f:
    manifest = json.load(f)
with open(os.path.join(DATA_DIR, "magnitude_model.onnx"), "rb") as f:
    magnitude_b64 = base64.b64encode(f.read()).decode()
with open(os.path.join(DATA_DIR, "shape_model.onnx"), "rb") as f:
    shape_b64 = base64.b64encode(f.read()).decode()

payload = json.dumps({
    "manifest": manifest,
    "magnitudeModelOnnxBase64": magnitude_b64,
    "shapeModelOnnxBase64": shape_b64,
}).encode()

req = urllib.request.Request(
    f"{app_base_url}/api/internal/forecast/ml-retrain-promote",
    data=payload,
    headers={
        "Authorization": f"Bearer {os.environ['CRON_SECRET']}",
        "Content-Type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(req, timeout=120) as resp:
    print(resp.read().decode())
PYEOF

echo "[ml-retrain] Done."
