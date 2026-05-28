#!/usr/bin/env bash
# Install root dev deps (php-cs-fixer, phpunit) without a host Composer binary.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if command -v composer >/dev/null 2>&1; then
  exec composer install --no-interaction --no-progress --prefer-dist "$@"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "composer: not found and docker unavailable." >&2
  echo "Install one of:" >&2
  echo "  brew install php composer" >&2
  echo "  Docker Desktop, then re-run: bash scripts/composer_install.sh" >&2
  exit 127
fi

echo "Using Docker image composer:2 (host has no composer)…" >&2
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -v "$ROOT:/app" \
  -w /app \
  composer:2 \
  install --no-interaction --no-progress --prefer-dist "$@"
