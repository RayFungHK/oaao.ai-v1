#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -f vendor/bin/phpunit ]]; then
  bash "$ROOT/scripts/composer_install.sh"
fi
if command -v php >/dev/null 2>&1 && [[ -x vendor/bin/phpunit ]]; then
  exec php vendor/bin/phpunit -c phpunit.xml.dist "$@"
fi
if command -v docker >/dev/null 2>&1; then
  exec docker run --rm \
    -v "$ROOT:/app" \
    -w /app \
    php:8.2-cli \
    php vendor/bin/phpunit -c phpunit.xml.dist "$@"
fi
echo "phpunit not found; run: bash scripts/composer_install.sh" >&2
exit 127
