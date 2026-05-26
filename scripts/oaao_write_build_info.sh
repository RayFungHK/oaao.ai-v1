#!/usr/bin/env bash
# Write oaao.ai-v1 version + build metadata for PHP shell and Python orchestrator.
# Run after git pull or before docker compose build so devs see the current build id.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${ROOT}/VERSION"
OUT_REPO="${ROOT}/build/oaao_build_info.json"
OUT_CONFIG="${ROOT}/backbone/config/oaaoai/build_info.json"

read -r VERSION_RAW < "${VERSION_FILE}"
VERSION="$(echo "${VERSION_RAW}" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

GIT_SHA="dev"
GIT_BRANCH="local"
DIRTY=false
if command -v git >/dev/null 2>&1 && git -C "${ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_SHA="$(git -C "${ROOT}" rev-parse --short HEAD 2>/dev/null || echo dev)"
  GIT_BRANCH="$(git -C "${ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo local)"
  if ! git -C "${ROOT}" diff --quiet 2>/dev/null || ! git -C "${ROOT}" diff --cached --quiet 2>/dev/null; then
    DIRTY=true
  fi
fi

BUILT_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
BUILD_ID="${GIT_SHA}"
if [[ "${DIRTY}" == "true" ]]; then
  BUILD_ID="${BUILD_ID}-dirty"
fi

mkdir -p "$(dirname "${OUT_REPO}")" "$(dirname "${OUT_CONFIG}")"

python3 - <<PY
import json
from pathlib import Path

payload = {
    "version": "${VERSION}",
    "build_id": "${BUILD_ID}",
    "built_at": "${BUILT_AT}",
    "git_sha": "${GIT_SHA}",
    "git_branch": "${GIT_BRANCH}",
    "dirty": $( [[ "${DIRTY}" == "true" ]] && echo true || echo false ),
    "component": "oaaoai-v1",
}
text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
for path in (Path("${OUT_REPO}"), Path("${OUT_CONFIG}")):
    path.write_text(text, encoding="utf-8")
    print(f"wrote {path}")
PY
