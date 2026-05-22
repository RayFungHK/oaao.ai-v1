#!/usr/bin/env bash
# Local / CI entry: bridge isolation gate + Python contract tests.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Cross-module require gate (chat, live-meeting, slide-designer) =="
bash scripts/audit_cross_module_requires.sh --gate

echo ""
echo "== Orchestrator bridge contract tests =="
PY="${PYTHON:-python3}"
run_pytest() {
  (cd python && "$PY" -m pytest \
    tests/test_orchestrator_bridge_contract.py \
    tests/test_pipeline_hook_resilience.py \
    tests/test_php_namespace_use_contract.py \
    -q)
}
if "$PY" -m pytest --version >/dev/null 2>&1; then
  run_pytest
else
  echo "pytest not installed; running contract tests inline (pip install pytest recommended)"
  (cd python && "$PY" - <<'PY'
from pathlib import Path
import importlib.util
import sys

def run_test_file(filename: str) -> None:
    path = Path("tests") / filename
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[path.stem] = mod
    spec.loader.exec_module(mod)
    for name in sorted(dir(mod)):
        if not name.startswith("test_"):
            continue
        fn = getattr(mod, name)
        if callable(fn):
            fn()
            print(f"ok {filename}::{name}")

for _f in (
    "test_orchestrator_bridge_contract.py",
    "test_php_namespace_use_contract.py",
):
    run_test_file(_f)
try:
    import pytest  # noqa: F401
except ImportError:
    print("skip test_pipeline_hook_resilience.py (pytest not installed)")
else:
    run_test_file("test_pipeline_hook_resilience.py")
PY
  )
fi

echo ""
echo "ci_check: OK"
