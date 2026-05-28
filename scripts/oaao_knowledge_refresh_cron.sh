#!/usr/bin/env bash
# WS-1-S5/S6 — trigger Knowledge bucket scheduled refresh (Settings-aware via PHP).
# Usage: oaao_knowledge_refresh_cron.sh [--force]
set -euo pipefail

FORCE="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${OAAO_ENV_FILE:-${ROOT}/docker/env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

SECRET="${OAAO_ORCH_SHARED_SECRET:-}"
if [[ -z "${SECRET}" ]]; then
  echo "OAAO_ORCH_SHARED_SECRET is required" >&2
  exit 1
fi

# Prefer explicit base; else derive from vault poll URL (same as orchestrator knowledge_cron_poll_loop).
BASE="${OAAO_KNOWLEDGE_CRON_BASE_URL:-}"
if [[ -z "${BASE}" ]]; then
  VPOLL="${OAAO_VAULT_JOB_POLL_BASE_URL:-}"
  if [[ -n "${VPOLL}" ]]; then
    BASE="${VPOLL%/vault/api}/endpoints/api"
  fi
fi
if [[ -z "${BASE}" ]]; then
  BASE="http://127.0.0.1/endpoints/api"
fi

URL="${BASE%/}/knowledge_cron_run"
BODY='{}'
if [[ "${FORCE}" == "--force" ]]; then
  BODY='{"force":true}'
fi

echo "POST ${URL}"
curl -fsS -X POST \
  -H "X-OAAO-Internal-Token: ${SECRET}" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d "${BODY}"
echo
