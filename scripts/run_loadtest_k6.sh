#!/usr/bin/env bash
# W13-S1 — run k6 profile + capture profiling / queue-depth samples.
#
# Usage:
#   bash scripts/run_loadtest_k6.sh baseline-soak
#   bash scripts/run_loadtest_k6.sh stress-burst
#
# Requires: k6 on PATH, OAAO_ORCH_SHARED_SECRET (or docker/env)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-baseline-soak}"
DATE_TAG="$(date -u +"%Y-%m-%d")"
OUT_DIR="${ROOT}/loadtest/${DATE_TAG}"
ENV_FILE="${OAAO_DOCKER_ENV:-${ROOT}/docker/env}"

case "${PROFILE}" in
  baseline-soak|stress-burst) ;;
  -h|--help)
    sed -n '2,8p' "$0"
    exit 0
    ;;
  *)
    echo "Unknown profile: ${PROFILE} (use baseline-soak or stress-burst)" >&2
    exit 2
    ;;
esac

SCRIPT="${ROOT}/loadtest/k6/${PROFILE}.js"
if [[ ! -f "${SCRIPT}" ]]; then
  echo "Missing ${SCRIPT}" >&2
  exit 2
fi

if [[ -z "${OAAO_ORCH_SHARED_SECRET:-}" && -f "${ENV_FILE}" ]]; then
  export OAAO_ORCH_SHARED_SECRET="$(grep -E '^OAAO_ORCH_SHARED_SECRET=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
fi
if [[ -z "${OAAO_ORCH_SHARED_SECRET:-}" ]]; then
  echo "Set OAAO_ORCH_SHARED_SECRET" >&2
  exit 2
fi

mkdir -p "${OUT_DIR}"
SUMMARY="${OUT_DIR}/k6-${PROFILE}-summary.json"
PROFILING="${OUT_DIR}/orch-profiling.json"
QUEUE_CSV="${OUT_DIR}/queue-depth.csv"

echo "== Output: ${OUT_DIR} =="

# Background queue sampler (5s) for the k6 run duration.
MON_PID=""
if command -v bash >/dev/null 2>&1; then
  DURATION_SEC=1800
  if [[ "${PROFILE}" == "stress-burst" ]]; then
    DURATION_SEC=420
  fi
  bash "${ROOT}/scripts/redis_canary_monitor.sh" \
    --interval 5 \
    --duration "${DURATION_SEC}" \
    --csv "${QUEUE_CSV}" &
  MON_PID=$!
fi

set +e
k6 run --summary-export "${SUMMARY}" "${SCRIPT}"
K6_EXIT=$?
set -e

if [[ -n "${MON_PID}" ]]; then
  wait "${MON_PID}" 2>/dev/null || true
fi

BASE="${OAAO_ORCHESTRATOR_URL:-http://127.0.0.1:8103}"
BASE="${BASE%/}"
curl -fsS -H "X-OAAO-Internal-Token: ${OAAO_ORCH_SHARED_SECRET}" \
  "${BASE}/v1/admin/profiling" > "${PROFILING}" 2>/dev/null \
  || echo '{"ok":false,"note":"profiling fetch failed"}' > "${PROFILING}"

echo "Wrote:"
echo "  ${SUMMARY}"
echo "  ${PROFILING}"
echo "  ${QUEUE_CSV}"

exit "${K6_EXIT}"
