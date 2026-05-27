#!/usr/bin/env bash
# W12-S1 — perf regression gate (Top-20 #19). Advisory thresholds from docs/W1_S2_Baseline_KPI.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/python"

echo "== perf gate: frozen perf contracts =="
python3 -m pytest ../Test_Suite/perf -q --tb=short

echo "== perf gate: profiling contract (zero cost when disabled) =="
python3 -m pytest tests/test_w9_w10_observability.py -q --tb=short

echo "== perf gate: hot-path timer smoke =="
python3 - <<'PY'
import os
import time

os.environ["OAAO_PROFILING_ENABLED"] = "1"
os.environ["OAAO_PROFILING_SAMPLE_CAP"] = "64"

from oaao_orchestrator.profiling import hot_path_timer, profiling_snapshot

with hot_path_timer("perf_gate_smoke"):
    time.sleep(0.002)

snap = profiling_snapshot()
rows = snap.get("timers") or {}
assert "perf_gate_smoke" in rows, snap
count = int(rows["perf_gate_smoke"].get("count") or 0)
assert count >= 1
p95 = float(rows["perf_gate_smoke"].get("p95_ms") or 0)
assert p95 < 500.0, f"p95_ms too high: {p95}"
print(f"perf_gate_smoke p95_ms={p95:.3f} count={count}")
PY

echo "perf gate: OK"
