#!/usr/bin/env bash
# W8-S3 / W13 — sample orchestrator queue metrics (+ optional Redis XLEN/XPENDING).
#
# Usage:
#   bash scripts/redis_canary_monitor.sh
#   bash scripts/redis_canary_monitor.sh --interval 900 --duration 86400   # Stage 2: 15m × 24h
#   bash scripts/redis_canary_monitor.sh --interval 5 --duration 1800 --csv loadtest/2026-05-27/queue-depth.csv
#
# Env: OAAO_ORCHESTRATOR_INTERNAL_URL, OAAO_ORCH_SHARED_SECRET (or read from docker/env)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${OAAO_DOCKER_ENV:-${ROOT}/docker/env}"
INTERVAL=900
DURATION=0
CSV_OUT=""
BASE="${OAAO_ORCHESTRATOR_INTERNAL_URL:-http://127.0.0.1:8103}"
SECRET="${OAAO_ORCH_SHARED_SECRET:-}"
STREAM="${OAAO_QUEUE_REDIS_STREAM:-oaao:queue:post_stream_metrics}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval) INTERVAL="${2:-900}"; shift 2 ;;
    --duration) DURATION="${2:-0}"; shift 2 ;;
    --csv) CSV_OUT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "${SECRET}" && -f "${ENV_FILE}" ]]; then
  SECRET="$(grep -E '^OAAO_ORCH_SHARED_SECRET=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
fi
if [[ -z "${SECRET}" ]]; then
  echo "Set OAAO_ORCH_SHARED_SECRET or populate docker/env" >&2
  exit 2
fi
BASE="${BASE%/}"

if [[ -n "${CSV_OUT}" ]]; then
  mkdir -p "$(dirname "${CSV_OUT}")"
  if [[ ! -f "${CSV_OUT}" ]]; then
    echo "ts,queue_backend,queue_depth,xlen,xpending,xack_failures" > "${CSV_OUT}"
  fi
fi

sample_once() {
  local ts payload backend depth xack xlen xpending
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  payload="$(curl -fsS -H "X-OAAO-Internal-Token: ${SECRET}" "${BASE}/v1/work_queues/status" 2>/dev/null || echo '{}')"
  backend="$(echo "${payload}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('queue_backend',''))" 2>/dev/null || echo '')"
  depth="$(echo "${payload}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
pools=d.get('post_stream_pools') or []
print(sum(int(p.get('queue_depth') or 0) for p in pools if isinstance(p,dict)))
" 2>/dev/null || echo 0)"
  xack="$(echo "${payload}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
pools=d.get('post_stream_pools') or []
print(max([int(p.get('xack_failures') or 0) for p in pools if isinstance(p,dict)] or [0]))
" 2>/dev/null || echo 0)"
  xlen=""
  xpending=""
  if [[ "${backend}" == "redis" ]]; then
    xlen="$("${COMPOSE[@]}" --profile redis-canary exec -T redis redis-cli XLEN "${STREAM}" 2>/dev/null | tr -d '\r' || echo '')"
    xpending="$("${COMPOSE[@]}" --profile redis-canary exec -T redis redis-cli XPENDING "${STREAM}" oaao-orchestrator 2>/dev/null | head -1 | awk '{print $1}' | tr -d '\r' || echo '')"
  fi
  echo "[${ts}] backend=${backend} depth=${depth} xack_failures=${xack} xlen=${xlen:-n/a} xpending=${xpending:-n/a}"
  if [[ -n "${CSV_OUT}" ]]; then
    echo "${ts},${backend},${depth},${xlen:-},${xpending:-},${xack}" >> "${CSV_OUT}"
  fi
}

end_ts=0
if [[ "${DURATION}" -gt 0 ]]; then
  end_ts=$(( $(date +%s) + DURATION ))
fi

while true; do
  sample_once
  if [[ "${end_ts}" -gt 0 && $(date +%s) -ge "${end_ts}" ]]; then
    break
  fi
  if [[ "${DURATION}" -eq 0 ]]; then
    break
  fi
  sleep "${INTERVAL}"
done
