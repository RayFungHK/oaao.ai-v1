#!/usr/bin/env bash
# Pre-flight sandbox: catch most regressions without manual UI testing.
#
# Usage:
#   bash scripts/sandbox_check.sh              # quick (default): lint + audits + CI pytest subset + namespace contract
#   bash scripts/sandbox_check.sh --python     # + full python/tests (needs requirements-orchestrator-app.txt)
#   bash scripts/sandbox_check.sh --docker       # + HTTP smoke (compose must be up: web + orchestrator)
#   bash scripts/sandbox_check.sh --all          # quick + python + docker
#
# Env:
#   PYTHON=python3.12   interpreter for pytest
#   OAAO_WEB_URL        default http://127.0.0.1:${OAAO_WEB_PORT:-8080}
#   OAAO_ORCHESTRATOR_INTERNAL_URL  default http://127.0.0.1:${OAAO_SIDECAR_PORT:-8103}
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY="${PYTHON:-python3}"
RUN_PYTHON=0
RUN_DOCKER=0

for arg in "$@"; do
  case "$arg" in
    --python) RUN_PYTHON=1 ;;
    --docker) RUN_DOCKER=1 ;;
    --all) RUN_PYTHON=1; RUN_DOCKER=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

step() { echo ""; echo "== $* =="; }

step "PHP syntax (oaaoai tree)"
if command -v php >/dev/null 2>&1; then
  bash scripts/php_lint_oaaoai.sh
elif docker compose ps web --status running -q 2>/dev/null | grep -q .; then
  docker compose exec -T web sh -c 'n=0; f=0; while IFS= read -r -d "" p; do n=$((n+1)); php -l "$p" >/dev/null || { php -l "$p"; f=$((f+1)); }; done < <(find /var/www/html/sites/oaaoai/oaaoai -name "*.php" -print0); test "$f" -eq 0 && echo "php_lint: OK ($n files)" || exit 1'
else
  echo "skip: no local php and web container not running"
fi

step "Cross-module require gate"
bash scripts/audit_cross_module_requires.sh --gate

step "Cross-module require (full tree)"
bash scripts/audit_cross_module_requires.sh

step "CI bridge + hook pytest"
if ! "$PY" -m pytest --version >/dev/null 2>&1; then
  echo "Installing CI deps into current interpreter…" >&2
  "$PY" -m pip install -q -r python/requirements-ci.txt
fi
(
  cd python
  "$PY" -m pytest \
    tests/test_orchestrator_bridge_contract.py \
    tests/test_pipeline_hook_resilience.py \
    tests/test_php_namespace_use_contract.py \
    -q
)

if [[ "$RUN_PYTHON" == "1" ]]; then
  step "Full Python test suite"
  if ! "$PY" -c "import pymupdf" 2>/dev/null; then
    echo "Installing orchestrator deps (heavy)…" >&2
    "$PY" -m pip install -q -r python/requirements-orchestrator-app.txt
  fi
  (cd python && "$PY" -m pytest tests/ -q --tb=no -q 2>/dev/null || (cd python && "$PY" -m pytest tests/ -q))
fi

if [[ "$RUN_DOCKER" == "1" ]]; then
  step "Docker HTTP smoke"
  WEB="${OAAO_WEB_URL:-http://127.0.0.1:${OAAO_WEB_PORT:-8080}}"
  WEB="${WEB%/}"
  ORCH="${OAAO_ORCHESTRATOR_INTERNAL_URL:-http://127.0.0.1:${OAAO_SIDECAR_PORT:-8103}}"
  ORCH="${ORCH%/}"

  curl -fsS "${ORCH}/health" >/dev/null || {
    echo "orchestrator not reachable at ${ORCH} (docker compose up -d orchestrator?)" >&2
    exit 1
  }
  echo "orchestrator health OK"

  # Core lazy route (no auth)
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${WEB}/health" 2>/dev/null || echo 000)"
  if [[ "$code" == "200" || "$code" == "204" ]]; then
    echo "web /health HTTP ${code} OK"
  else
    echo "WARN: web ${WEB}/health returned HTTP ${code} (install wizard or routing may differ)"
  fi

  OAAO_ORCHESTRATOR_INTERNAL_URL="${ORCH}" OAAO_SMOKE_START_CHAT_RUN=1 bash scripts/oaao_orchestrator_smoke.sh
fi

step "sandbox_check: OK"
