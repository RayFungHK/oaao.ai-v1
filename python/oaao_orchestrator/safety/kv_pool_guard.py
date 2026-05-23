"""
KV pool budget guard — reject new work when vLLM PagedAttention pool > 85% (Audit §7.3).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import wraps
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")

THRESHOLD_RATIO = 0.85
RESERVE_GB = 2.0

_budget_lock = asyncio.Lock()
_budget_in_flight = 0


@dataclass(frozen=True)
class KvBudgetDecision:
    allow: bool
    retry_after_seconds: int | None = None
    http_status: int | None = None


class KvPoolFull(Exception):
    """KV pool over budget — caller should return 503 with retry-after."""

    def __init__(self, retry_after_seconds: int = 2) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"KV pool budget exceeded; retry after {retry_after_seconds}s")


def _current_kv_usage_gb() -> float:
    return 0.0


def _pool_max_gb() -> float:
    return 40.0


def check_kv_budget(used_gb: float, pool_max_gb: float = 40.0) -> KvBudgetDecision:
    if pool_max_gb <= 0:
        return KvBudgetDecision(allow=False, retry_after_seconds=2, http_status=503)
    ratio = float(used_gb) / float(pool_max_gb)
    if ratio >= THRESHOLD_RATIO:
        return KvBudgetDecision(allow=False, retry_after_seconds=2, http_status=503)
    return KvBudgetDecision(allow=True)


def guarded_call(fn: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
    """Decorator — reserve KV budget for the duration of ``fn``."""

    @wraps(fn)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        global _budget_in_flight
        async with _budget_lock:
            base = _current_kv_usage_gb()
            projected = base + _budget_in_flight * RESERVE_GB
            decision = check_kv_budget(projected, _pool_max_gb())
            if not decision.allow:
                raise KvPoolFull(decision.retry_after_seconds or 2)
            _budget_in_flight += 1
        try:
            return await fn(*args, **kwargs)
        finally:
            async with _budget_lock:
                _budget_in_flight = max(0, _budget_in_flight - 1)

    return wrapper
