"""Register built-in Python MM modules at import time."""

from __future__ import annotations

from oaao_orchestrator.media.adapters.lance import LanceMmAdapter
from oaao_orchestrator.media.mm_python_module import register

_BOOTSTRAPPED = False


def ensure_mm_python_modules_registered() -> None:
    global _BOOTSTRAPPED
    if _BOOTSTRAPPED:
        return
    register(LanceMmAdapter(), aliases=["lance"])
    _BOOTSTRAPPED = True
