#!/usr/bin/env bash
# W1-S2 — Baseline KPI daily snapshot.
#
# Emits one JSON file per UTC day to docs/kpi/YYYY-MM-DD.json.
# Pure best-effort: every probe is wrapped so a missing tool yields a null
# field rather than failing the snapshot. This keeps the cron job green even
# while individual signals are still being wired.
#
# Usage:
#   bash scripts/kpi_snapshot.sh           # write docs/kpi/<date>.json
#   bash scripts/kpi_snapshot.sh --stdout  # print to stdout, no file write
#
# Schema is documented in docs/W1_S2_Baseline_KPI.md.

set -u
set -o pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repo_root"

STDOUT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --stdout) STDOUT_ONLY=1 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
  esac
done

captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
day="$(date -u +%Y-%m-%d)"
git_sha="$(git rev-parse --short=10 HEAD 2>/dev/null || echo unknown)"

# ── helpers ────────────────────────────────────────────────────────────────
json_null='null'

emit_int_or_null() {
  if [[ -n "${1:-}" && "$1" =~ ^[0-9]+$ ]]; then
    printf '%s' "$1"
  else
    printf '%s' "$json_null"
  fi
}
emit_num_or_null() {
  if [[ -n "${1:-}" && "$1" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    printf '%s' "$1"
  else
    printf '%s' "$json_null"
  fi
}

# ── tests: pass-rate from latest pytest run ────────────────────────────────
tests_passed="$json_null"
tests_failed="$json_null"
tests_skipped="$json_null"
tests_pass_rate="$json_null"

if command -v python >/dev/null 2>&1 && [[ -d python ]]; then
  pytest_out="$(cd python && python -m pytest -q --no-header \
                  --ignore=tests/test_template_pages.py 2>/dev/null \
                  | tail -n 5 || true)"
  # Expected last line shape: "12 failed, 223 passed, 3 skipped in 2.11s"
  p=$(printf '%s' "$pytest_out" | grep -oE '[0-9]+ passed' | head -1 | grep -oE '[0-9]+' || true)
  f=$(printf '%s' "$pytest_out" | grep -oE '[0-9]+ failed' | head -1 | grep -oE '[0-9]+' || true)
  s=$(printf '%s' "$pytest_out" | grep -oE '[0-9]+ skipped' | head -1 | grep -oE '[0-9]+' || true)
  tests_passed=$(emit_int_or_null "$p")
  tests_failed=$(emit_int_or_null "$f")
  tests_skipped=$(emit_int_or_null "$s")
  if [[ "$tests_passed" != "$json_null" && "$tests_failed" != "$json_null" ]]; then
    total=$(( tests_passed + tests_failed ))
    if (( total > 0 )); then
      tests_pass_rate=$(awk -v p="$tests_passed" -v t="$total" 'BEGIN{ printf "%.2f", (p*100.0)/t }')
    fi
  fi
fi

# ── code_health: ruff BLE count ────────────────────────────────────────────
broad_except="$json_null"
if command -v ruff >/dev/null 2>&1 || python -m ruff --version >/dev/null 2>&1; then
  ruff_out=$(python -m ruff check python --select BLE --statistics 2>/dev/null || true)
  count=$(printf '%s' "$ruff_out" | awk '/BLE/ { s+=$1 } END { print s+0 }')
  broad_except=$(emit_int_or_null "$count")
fi

# ── code_health: php-cs-fixer violations ───────────────────────────────────
php_style="$json_null"
if command -v php >/dev/null 2>&1 && [[ -x vendor/bin/php-cs-fixer ]]; then
  pcf_out=$(vendor/bin/php-cs-fixer fix --dry-run --format=junit 2>/dev/null || true)
  # JUnit "<failure" count
  pcf_count=$(printf '%s' "$pcf_out" | grep -oE '<failure' | wc -l | tr -d ' ' || true)
  php_style=$(emit_int_or_null "$pcf_count")
fi

# ── debt: Top-20 burn-down from W1 doc ─────────────────────────────────────
top20_closed_pct="$json_null"
p0_closed_pct="$json_null"
debt_doc="docs/W1_Top20_TechDebt_Owner_Framework.md"
if [[ -f "$debt_doc" ]]; then
  done_count=$(grep -cE '\| ✅ Done ' "$debt_doc" || true)
  if [[ -n "$done_count" && "$done_count" =~ ^[0-9]+$ ]]; then
    top20_closed_pct=$(awk -v d="$done_count" 'BEGIN{ printf "%.1f", (d*100.0)/20.0 }')
  fi
  # P0 lines are those with " P0 " in the table row
  p0_total=$(grep -cE '\| P0 \|' "$debt_doc" || true)
  p0_done=$(grep -E '\| P0 \|' "$debt_doc" | grep -cE '✅ Done' || true)
  if [[ "$p0_total" =~ ^[0-9]+$ && "$p0_total" -gt 0 ]]; then
    p0_closed_pct=$(awk -v d="$p0_done" -v t="$p0_total" 'BEGIN{ printf "%.1f", (d*100.0)/t }')
  fi
fi

# ── contract_drift: run contract parity tests ──────────────────────────────
contract_drift="$json_null"
if [[ -d python/tests ]]; then
  drift_rc=$(cd python && python -m pytest -q \
              tests/test_errors_contract.py::test_php_mirror_codes_match \
              tests/test_contracts_v1.py::test_error_code_list_matches_python_enum \
              >/dev/null 2>&1; echo $?)
  if [[ "$drift_rc" == "0" ]]; then contract_drift=0; else contract_drift=1; fi
fi

# ── compose snapshot ───────────────────────────────────────────────────────
snapshot=$(cat <<JSON
{
  "schema_version": "1",
  "captured_at": "${captured_at}",
  "git_sha": "${git_sha}",
  "error_rate":  { "http_5xx_24h": ${json_null}, "ws_4xxx_24h": ${json_null} },
  "latency":     { "chat_ttfb_p95_ms": ${json_null}, "vault_job_p95_ms": ${json_null} },
  "tests":       { "pass_rate_pct": ${tests_pass_rate}, "coverage_py_pct": ${json_null}, "passed": ${tests_passed}, "failed": ${tests_failed}, "skipped": ${tests_skipped} },
  "security":    { "vuln_high": ${json_null}, "vuln_med": ${json_null} },
  "code_health": { "broad_except": ${broad_except}, "php_style": ${php_style}, "contract_drift": ${contract_drift} },
  "debt":        { "top20_closed_pct": ${top20_closed_pct}, "p0_closed_pct": ${p0_closed_pct} }
}
JSON
)

if [[ "$STDOUT_ONLY" == "1" ]]; then
  printf '%s\n' "$snapshot"
else
  mkdir -p docs/kpi
  out="docs/kpi/${day}.json"
  printf '%s\n' "$snapshot" >"$out"
  printf 'KPI snapshot → %s\n' "$out"
fi
