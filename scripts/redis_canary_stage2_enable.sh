#!/usr/bin/env bash
# W8-S3 Stage 2 — enable Redis queue backend on a single orchestrator replica.
#
# Usage (from repo root):
#   bash scripts/redis_canary_stage2_enable.sh           # patch docker/env + recreate
#   bash scripts/redis_canary_stage2_enable.sh --check   # verify backend only
#   bash scripts/redis_canary_stage2_enable.sh --rollback
#
# See docs/W8_S3_RedisCanaryRollout.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${OAAO_DOCKER_ENV:-${ROOT}/docker/env}"
COMPOSE=(docker compose --project-directory "${ROOT}")

MODE="${1:-enable}"
REDIS_URL="${OAAO_QUEUE_REDIS_URL:-redis://redis:6379/0}"

ensure_env_block() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE} — copy from docker/env.example first." >&2
    exit 2
  fi
}

set_env_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "${ENV_FILE}"
  else
    printf '\n%s=%s\n' "${key}" "${val}" >> "${ENV_FILE}"
  fi
}

remove_env_kv() {
  local key="$1"
  sed -i.bak "/^${key}=/d" "${ENV_FILE}" 2>/dev/null || true
}

verify_backend() {
  local secret
  secret="$(grep -E '^OAAO_ORCH_SHARED_SECRET=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
  if [[ -z "${secret}" ]]; then
    echo "OAAO_ORCH_SHARED_SECRET missing in ${ENV_FILE}" >&2
    exit 2
  fi
  echo "== GET /v1/work_queues/status =="
  "${COMPOSE[@]}" exec -T orchestrator curl -fsS \
    -H "X-OAAO-Internal-Token: ${secret}" \
    "http://127.0.0.1:8103/v1/work_queues/status" | python3 -m json.tool
}

case "${MODE}" in
  --check|check)
    verify_backend
    exit 0
    ;;
  --rollback|rollback)
    ensure_env_block
    set_env_kv "OAAO_QUEUE_BACKEND" "memory"
    remove_env_kv "OAAO_QUEUE_REDIS_URL"
    echo "Rollback: OAAO_QUEUE_BACKEND=memory in ${ENV_FILE}"
    "${COMPOSE[@]}" up -d --force-recreate orchestrator
    sleep 3
    verify_backend
    exit 0
    ;;
  --help|-h)
    sed -n '2,12p' "$0"
    exit 0
    ;;
esac

ensure_env_block
echo "== Start redis (profile redis-canary) =="
"${COMPOSE[@]}" --profile redis-canary up -d redis

set_env_kv "OAAO_QUEUE_BACKEND" "redis"
set_env_kv "OAAO_QUEUE_REDIS_URL" "${REDIS_URL}"

echo "Patched ${ENV_FILE}:"
grep -E '^OAAO_QUEUE_(BACKEND|REDIS_URL)=' "${ENV_FILE}" || true

echo "== Recreate orchestrator =="
"${COMPOSE[@]}" up -d --force-recreate orchestrator

echo "Waiting for orchestrator health..."
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T orchestrator curl -fsS "http://127.0.0.1:8103/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

verify_backend
echo ""
echo "Stage 2 enabled. Monitor for 24h:"
echo "  bash scripts/redis_canary_monitor.sh --interval 900 --duration 86400"
