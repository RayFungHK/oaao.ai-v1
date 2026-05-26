#!/usr/bin/env bash
# W11-S1 — rotate the local dev OAAO_ORCH_SHARED_SECRET in docker/env.
#
# Usage:
#   ./scripts/rotate_dev_secret.sh             # rotate in place (creates backup)
#   ./scripts/rotate_dev_secret.sh --print     # only print a new secret, do not write
#
# The file docker/env is *not* tracked in git (see .gitignore). Production should
# inject OAAO_ORCH_SHARED_SECRET via a secret manager (AWS SM / Vault / Doppler /
# k8s Secret) — this script is for local dev only.

set -euo pipefail

ENV_FILE="${ENV_FILE:-docker/env}"
KEY="OAAO_ORCH_SHARED_SECRET"

new_secret() {
  # 32 random bytes -> 64 hex chars
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 -c 'import secrets; print(secrets.token_hex(32))'
  fi
}

if [[ "${1:-}" == "--print" ]]; then
  new_secret
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy from docker/env.example first." >&2
  exit 1
fi

SECRET="$(new_secret)"
BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$BACKUP"

if grep -q "^${KEY}=" "$ENV_FILE"; then
  # Replace existing line
  python3 - "$ENV_FILE" "$KEY" "$SECRET" <<'PY'
import pathlib, re, sys
path, key, secret = sys.argv[1:]
text = pathlib.Path(path).read_text(encoding="utf-8")
new = re.sub(rf"(?m)^{re.escape(key)}=.*$", f"{key}={secret}", text)
pathlib.Path(path).write_text(new, encoding="utf-8")
PY
else
  printf '\n%s=%s\n' "$KEY" "$SECRET" >> "$ENV_FILE"
fi

echo "Rotated ${KEY} in ${ENV_FILE}"
# Mirror to project-root .env so docker compose can resolve interpolation in
# docker-compose.yml. env_file only injects into the container, not compose.
ROOT_ENV="$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")/.env"
cp "$ENV_FILE" "$ROOT_ENV"
echo "Mirrored to ${ROOT_ENV} (for compose interpolation)"
echo "Backup: ${BACKUP}"
echo "Restart: docker compose up -d orchestrator web"
