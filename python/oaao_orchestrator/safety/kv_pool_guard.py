"""
KV pool budget guard — reject when utilization exceeds 85% (Audit §7.3).

Tests mock ``_current_kv_usage_gb`` / ``_pool_max_gb``; production can wire vLLM metrics.
"""

from __future__ import annotations

import asyncio
import functools
import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar

F = TypeVar("F", bound=Callable[..., Any])

_in_flight = 0
_in_flight_lock = asyncio.Lock()
_RESERVATION_GB = 2.0


class KvPoolFull(Exception):
    def __init__(self, *, retry_after_seconds: int = 2, http_status: int = 503) -> None:
        self.retry_after_seconds = retry_after_seconds
        self.http_status = http_status
        super().__init__(f"KV pool full (retry after {retry_after_seconds}s)")


@dataclass(frozen=True)
class KvBudgetDecision:
    allow: bool
    retry_after_seconds: int = 0
    http_status: int = 200


def _pool_max_gb() -> float:
    raw = (os.environ.get("OAAO_KV_POOL_MAX_GB") or "40").strip()
    try:
        return max(1.0, float(raw))
    except (TypeError, ValueError):
        return 40.0


def _current_kv_usage_gb() -> float:
    raw = (os.environ.get("OAAO_KV_USAGE_GB") or "").strip()
    if raw:
        try:
            return max(0.0, float(raw))
        except (TypeError, ValueError):
            pass
    return 0.0


def check_kv_budget(*, used_gb: float, pool_max_gb: float) -> KvBudgetDecision:
    threshold = pool_max_gb * 0.85
    if used_gb >= threshold:
        return KvBudgetDecision(allow=False, retry_after_seconds=2, http_status=503)
    return KvBudgetDecision(allow=True)


async def _effective_usage_gb() -> float:
    global _in_flight
    async with _in_flight_lock:
        reserved = _in_flight * _RESERVATION_GB
    return _current_kv_usage_gb() + reserved


def guarded_call(fn: F) -> F:  # noqa: UP047
    @functools.wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        global _in_flight
        decision = check_kv_budget(used_gb=await _effective_usage_gb(), pool_max_gb=_pool_max_gb())
        if not decision.allow:
            raise KvPoolFull(
                retry_after_seconds=decision.retry_after_seconds,
                http_status=decision.http_status,
            )
        async with _in_flight_lock:
            _in_flight += 1
        try:
            return await fn(*args, **kwargs)
        finally:
            async with _in_flight_lock:
                _in_flight = max(0, _in_flight - 1)

    return wrapper  # type: ignore[return-value]
