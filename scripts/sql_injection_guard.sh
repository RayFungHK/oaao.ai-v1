#!/usr/bin/env bash
# W11-S2 (backlog) — SQL injection regression guard.
#
# Heuristic: flag SQL string literals that interpolate a bare PHP variable
# directly into the SQL text. Allowed audited patterns are listed in
# scripts/sql_param_allowlist.txt (one substring per line, # for comments).
#
# This is a fast static check — not a replacement for code review — but it
# blocks the most common regression: a developer using "WHERE x = '$id'"
# instead of a prepared "?" placeholder.
#
# Exit codes:
#   0 — clean (no new violations)
#   1 — at least one un-allowlisted suspicious site found

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/backbone/sites/oaaoai/oaaoai"
ALLOWLIST="${ROOT}/scripts/sql_param_allowlist.txt"

if [[ ! -d "$SRC" ]]; then
  echo "sql_injection_guard: source tree not found ($SRC); skipping." >&2
  exit 0
fi

# Suspicious: SQL string literal (quoted) containing a DML keyword AND a bare
# `$var` interpolation that is NOT inside `{$...}` braces. The brace form is the
# audited dynamic-placeholder (`{$ph}` = `?,?,?`) or whitelisted-identifier
# pattern; the bare form is the dangerous one we want to block.
#
# Matched layouts:
#   "SELECT ... $id ..."   '... WHERE x = $foo ...'   "UPDATE t SET $col = ?"
# Not matched (audited-safe brace form):
#   "... WHERE x IN ({$ph})"   "SELECT FROM {$table}"
pattern='["'\''][^"'\'']*\b(SELECT|INSERT[[:space:]]+INTO|UPDATE|DELETE[[:space:]]+FROM|REPLACE[[:space:]]+INTO)\b[^"'\'']*[^{]\$[a-zA-Z_][a-zA-Z0-9_]*[^"'\'']*["'\'']'

raw=$(grep -RInE "$pattern" --include='*.php' "$SRC" 2>/dev/null || true)

if [[ -z "$raw" ]]; then
  echo "sql_injection_guard: clean"
  exit 0
fi

# Filter against allowlist substrings (allow file:line or unique fragment).
violations=""
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  ok=0
  if [[ -f "$ALLOWLIST" ]]; then
    while IFS= read -r allow; do
      allow_trim="${allow%%#*}"
      allow_trim="${allow_trim## }"
      allow_trim="${allow_trim%% }"
      [[ -z "$allow_trim" ]] && continue
      if [[ "$line" == *"$allow_trim"* ]]; then
        ok=1
        break
      fi
    done < "$ALLOWLIST"
  fi
  if [[ $ok -eq 0 ]]; then
    violations+="$line"$'\n'
  fi
done <<< "$raw"

if [[ -z "$violations" ]]; then
  echo "sql_injection_guard: clean (all matches allowlisted)"
  exit 0
fi

echo "::error::sql_injection_guard: un-allowlisted SQL variable interpolation detected." >&2
echo "$violations" >&2
echo "" >&2
echo "Fix: switch to prepared placeholders (?). For dynamic placeholder counts use" >&2
echo "     \$ph = implode(',', array_fill(0, count(\$ids), '?')); then 'IN ({\$ph})'" >&2
echo "     and bind values via execute(\$ids)." >&2
echo "If the match is a verified-safe identifier interpolation, append the" >&2
echo "file:line or a unique fragment to scripts/sql_param_allowlist.txt." >&2
exit 1
