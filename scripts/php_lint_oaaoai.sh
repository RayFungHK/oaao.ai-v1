#!/usr/bin/env bash
# Syntax-check all oaaoai distributor PHP (catches parse errors before runtime).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OAao="${ROOT}/backbone/sites/oaaoai/oaaoai"

if ! command -v php >/dev/null 2>&1; then
  echo "php not in PATH; skip php_lint (use: docker compose exec web bash scripts/php_lint_oaaoai.sh)" >&2
  exit 0
fi

failed=0
count=0
while IFS= read -r -d '' f; do
  count=$((count + 1))
  if ! php -l "$f" >/dev/null 2>&1; then
    php -l "$f" || true
    failed=$((failed + 1))
  fi
done < <(find "$OAao" -name '*.php' -print0)

if [[ $failed -gt 0 ]]; then
  echo "php_lint: ${failed}/${count} file(s) failed" >&2
  exit 1
fi

echo "php_lint: OK (${count} files)"
