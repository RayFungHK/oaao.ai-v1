#!/usr/bin/env bash
# Create python/.venv and install python/requirements.txt (oaao_orchestrator sidecar).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -f requirements.txt ]]; then
  echo "missing requirements.txt in $ROOT" >&2
  exit 1
fi

pick_python() {
  local c major minor
  for c in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$c" >/dev/null 2>&1; then
      read -r major minor <<<"$("$c" -c 'import sys; print(sys.version_info[0], sys.version_info[1])' 2>/dev/null)" || continue
      if [[ "${major:-0}" -eq 3 && "${minor:-0}" -ge 9 ]]; then
        printf '%s\n' "$c"
        return 0
      fi
    fi
  done
  echo "need Python 3.9+ (3.10+ recommended); install via brew/pyenv" >&2
  return 1
}

PY="$(pick_python)" || exit 1

if [[ ! -d .venv ]]; then
  "$PY" -m venv .venv
fi

# shellcheck source=/dev/null
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo "Ready: source \"$(pwd)/.venv/bin/activate\""
echo "Run orchestrator (from this directory): uvicorn oaao_orchestrator.app:app --host 127.0.0.1 --port 8103"
