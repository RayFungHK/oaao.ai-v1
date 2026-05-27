#!/usr/bin/env bash
# Trigger Article Research due-watch cron on PHP web.
# Usage: oaao_research_cron.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${OAAO_ENV_FILE:-${ROOT}/docker/env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

BASE="${OAAO_RESEARCH_CRON_BASE_URL:-http://127.0.0.1/research/api}"
SECRET="${OAAO_ORCH_SHARED_SECRET:-}"
if [[ -z "${SECRET}" ]]; then
  echo "OAAO_ORCH_SHARED_SECRET is required" >&2
  exit 1
fi

URL="${BASE%/}/cron_run"
echo "POST ${URL}"
curl -fsS -X POST \
  -H "X-OAAO-Internal-Token: ${SECRET}" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  "${URL}"
echo
