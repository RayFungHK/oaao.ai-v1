#!/usr/bin/env bash
# Detect cross-module require_once of another module's library/controller (P0 isolation).
#
# Modes:
#   --gate     CI gate: only chat, live-meeting, slide-designer; allow core + auth (P1).
#   (default)  Full tree report: allow register listeners + core controller paths; still allow core module.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OAao="${ROOT}/backbone/sites/oaaoai/oaaoai"

MODE="full"
GATE_MODULES=(chat live-meeting slide-designer)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gate)
      MODE="gate"
      shift
      ;;
    --gate-modules=*)
      MODE="gate"
      IFS=',' read -r -a GATE_MODULES <<< "${1#*=}"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--gate] [--gate-modules=chat,live-meeting,slide-designer]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

ALLOW_PREFIXES=(
  'endpoints/default/controller/event/'
  'auth/default/controller/'
  'core/default/controller/'
)

is_allowed_path() {
  local rel="$1"
  local mod="$2"
  local owner="$3"

  if [[ "$mod" == "core" || "$mod" == "$owner" ]]; then
    return 0
  fi

  if [[ "$MODE" == "gate" ]]; then
    if [[ "$mod" == "auth" ]]; then
      return 0
    fi
    return 1
  fi

  for a in "${ALLOW_PREFIXES[@]}"; do
    if [[ "$rel" == *"$a"* ]]; then
      return 0
    fi
  done

  return 1
}

in_gate_scope() {
  local rel="$1"
  local owner
  owner="$(echo "$rel" | cut -d/ -f1)"
  if [[ "$MODE" != "gate" ]]; then
    return 0
  fi
  local m
  for m in "${GATE_MODULES[@]}"; do
    if [[ "$owner" == "$m" ]]; then
      return 0
    fi
  done
  return 1
}

extract_required_module() {
  local line="$1"
  local mod=""
  mod="$(echo "$line" | sed -n "s|.*'/\\([^/]*\\)/default/library/.*|\\1|p" | head -n1)"
  if [[ -z "$mod" ]]; then
    mod="$(echo "$line" | sed -n "s|.*'/\\([^/]*\\)/default/controller/.*|\\1|p" | head -n1)"
  fi
  echo "$mod"
}

violations=0
scanned=0

while IFS= read -r -d '' file; do
  rel="${file#${OAao}/}"
  in_gate_scope "$rel" || continue
  scanned=$((scanned + 1))

  if ! grep -qE "require_once.*dirname\([^)]+\).*'/[a-z-]+/default/(library|controller)/" "$file" 2>/dev/null; then
    continue
  fi

  while IFS= read -r line; do
    if ! echo "$line" | grep -qE "require_once.*'/[a-z-]+/default/(library|controller)/"; then
      continue
    fi
    mod="$(extract_required_module "$line")"
    if [[ -z "$mod" ]]; then
      echo "WARN: could not parse module in ${rel}" >&2
      echo "  ${line}" >&2
      continue
    fi
    owner="$(echo "$rel" | cut -d/ -f1)"
    if is_allowed_path "$rel" "$mod" "$owner"; then
      continue
    fi
    echo "P0: ${rel}"
    echo "  ${line}"
    violations=$((violations + 1))
  done < <(grep "require_once.*dirname" "$file" || true)
done < <(find "$OAao" -name '*.php' -print0)

if [[ $violations -gt 0 ]]; then
  echo ""
  if [[ "$MODE" == "gate" ]]; then
    echo "${violations} cross-module require violation(s) in gate modules (${GATE_MODULES[*]})."
    echo "Peer modules must use api('module'); core/auth direct requires are allowed in --gate."
  else
    echo "${violations} cross-module require violation(s). Use api('module') or run with --gate for bridge modules only."
  fi
  exit 1
fi

if [[ "$MODE" == "gate" ]]; then
  echo "OK: gate modules (${GATE_MODULES[*]}) have no peer cross-module library/controller requires (${scanned} files scanned)."
else
  echo "OK: no P0 cross-module library/controller requires detected (${scanned} files scanned)."
fi
