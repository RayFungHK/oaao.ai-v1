#!/usr/bin/env bash
# Smoke: orchestrator health + optional chat run start (requires running sidecar).
set -euo pipefail

BASE="${OAAO_ORCHESTRATOR_INTERNAL_URL:-http://127.0.0.1:8103}"
SECRET="${OAAO_ORCH_SHARED_SECRET:-oaao_dev_shared_secret}"
BASE="${BASE%/}"

echo "== health =="
curl -fsS "${BASE}/health" | head -c 400
echo ""

echo "== funasr status (optional) =="
curl -fsS -H "X-OAAO-Internal-Token: ${SECRET}" "${BASE}/v1/funasr/status" 2>/dev/null | head -c 400 || echo "(skipped)"
echo ""

if [[ "${OAAO_SMOKE_START_CHAT_RUN:-0}" != "1" ]]; then
  echo "Set OAAO_SMOKE_START_CHAT_RUN=1 to POST /v1/runs/chat (needs valid endpoint env in orchestrator)."
  exit 0
fi

echo "== POST /v1/runs/chat (minimal) =="
BODY='{"messages":[{"role":"user","content":"smoke ping"}],"allowed_agents":["vault_rag"],"run_planner_mode":"fixed"}'
RESP=$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -H "X-OAAO-Internal-Token: ${SECRET}" \
  -d "${BODY}" \
  "${BASE}/v1/runs/chat")
echo "${RESP}" | head -c 600
echo ""
RUN_ID=$(echo "${RESP}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('run_id',''))" 2>/dev/null || true)
if [[ -n "${RUN_ID}" ]]; then
  echo "run_id=${RUN_ID}"
fi
