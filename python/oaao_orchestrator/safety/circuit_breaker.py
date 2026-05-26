"""
Async circuit breaker — Phase 8 (Audit §7.3, Evolution §4.4 / §5.4).

Used by IQS / ACCS / Reflection coach calls: open → skip scoring, do not block users.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any, ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")

_registry: dict[str, CircuitBreaker] = {}


class BreakerOpen(Exception):
    """Breaker is open — caller should degrade (skip hook, ship output, etc.)."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"Circuit breaker {name!r} is open")


class BreakerTimeout(Exception):
    """Wrapped call exceeded ``call_timeout``."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"Circuit breaker {name!r} call timed out")


class CircuitBreaker:
    """Three-state breaker: closed → open → half_open → closed."""

    def __init__(
        self,
        *,
        name: str,
        failure_threshold: int = 3,
        reset_timeout: float = 600.0,
        call_timeout: float = 8.0,
    ) -> None:
        self.name = name
        self.failure_threshold = max(1, int(failure_threshold))
        self.reset_timeout = float(reset_timeout)
        self.call_timeout = float(call_timeout)
        self.failure_count = 0
        self._state = "closed"
        self._opened_at: float | None = None

    @property
    def state(self) -> str:
        if self._state == "open" and self._opened_at is not None:  # noqa: SIM102
            if time.monotonic() - self._opened_at >= self.reset_timeout:
                self._state = "half_open"
        return self._state

    def force_open(self) -> None:
        self._state = "open"
        self._opened_at = time.monotonic()

    def reset(self) -> None:
        self._state = "closed"
        self.failure_count = 0
        self._opened_at = None

    async def call(self, fn: Callable[[], Awaitable[R] | R]) -> R:
        st = self.state
        if st == "open":
            raise BreakerOpen(self.name)

        try:
            if asyncio.iscoroutinefunction(fn):
                coro = fn()
            else:
                result = fn()
                if asyncio.iscoroutine(result):
                    coro = result
                else:
                    self._on_success(st)
                    return result  # type: ignore[return-value]
            out = await asyncio.wait_for(coro, timeout=self.call_timeout)
            self._on_success(st)
            return out
        except TimeoutError as exc:
            self._record_failure()
            raise BreakerTimeout(self.name) from exc
        except Exception:
            self._record_failure()
            raise

    def _on_success(self, st_at_entry: str) -> None:
        if st_at_entry == "half_open" or self._state == "half_open":
            self.reset()
        elif self._state == "closed":
            self.failure_count = 0

    def _record_failure(self) -> None:
        self.failure_count += 1
        if self.failure_count >= self.failure_threshold:
            self._state = "open"
            self._opened_at = time.monotonic()


def get_breaker(name: str, **kwargs: Any) -> CircuitBreaker:
    """Return a process-wide breaker instance (isolated per ``name``)."""
    if name not in _registry:
        _registry[name] = CircuitBreaker(name=name, **kwargs)
        return _registry[name]
    br = _registry[name]
    if "call_timeout" in kwargs:
        br.call_timeout = float(kwargs["call_timeout"])
    return br


def reset_all_breakers_for_tests() -> None:
    """Test helper — clear registry."""
    _registry.clear()


def circuit_breaker(
    *,
    name: str,
    failure_threshold: int = 3,
    reset_timeout: float = 600.0,
    call_timeout: float = 8.0,
) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """Decorator — routes calls through ``get_breaker(name).call``."""

    br = get_breaker(
        name,
        failure_threshold=failure_threshold,
        reset_timeout=reset_timeout,
        call_timeout=call_timeout,
    )

    def decorator(fn: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        @wraps(fn)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            async def invoke() -> R:
                return await fn(*args, **kwargs)

            return await br.call(invoke)

        return wrapper

    return decorator
