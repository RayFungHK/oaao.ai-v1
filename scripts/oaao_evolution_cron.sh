#!/usr/bin/env bash
# Trigger OAAO evolution cron endpoints on the orchestrator sidecar.
# Usage: oaao_evolution_cron.sh daily|weekly
set -euo pipefail

JOB="${1:-daily}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${OAAO_ENV_FILE:-${ROOT}/docker/env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

BASE="${OAAO_ORCHESTRATOR_INTERNAL_URL:-http://127.0.0.1:8103}"
SECRET="${OAAO_ORCH_SHARED_SECRET:-}"
if [[ -z "${SECRET}" ]]; then
  echo "OAAO_ORCH_SHARED_SECRET is required" >&2
  exit 1
fi

case "${JOB}" in
  weekly|weekly_apply)
    PATH_SUFFIX="/v1/admin/evolution/weekly_apply"
    ;;
  daily|daily_report|*)
    PATH_SUFFIX="/v1/admin/evolution/daily_report"
    ;;
esac

URL="${BASE%/}${PATH_SUFFIX}"
echo "POST ${URL}"
curl -fsS -X POST \
  -H "X-OAAO-Internal-Token: ${SECRET}" \
  -H "Accept: application/json" \
  "${URL}"
echo
