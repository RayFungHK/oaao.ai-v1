"""
Circuit Breaker contract freeze — Phase 8 implementation must satisfy.

Spec source: docs/Audit_Report.md §7.3, docs/Evolution_System_Design.md §3
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

cb = pytest.importorskip(
    "oaao_orchestrator.safety.circuit_breaker",
    reason="Phase 8 — safety.circuit_breaker not yet implemented",
)


def _make_breaker(name: str = "test", **kw: Any):
    defaults = dict(failure_threshold=3, reset_timeout=600.0, call_timeout=8.0)
    defaults.update(kw)
    return cb.CircuitBreaker(name=name, **defaults)


@pytest.mark.asyncio
async def test_breaker_opens_after_threshold_failures() -> None:
    b = _make_breaker(failure_threshold=3)

    async def boom():
        raise RuntimeError("boom")

    for _ in range(3):
        with pytest.raises(RuntimeError):
            await b.call(boom)
    assert b.state == "open"


@pytest.mark.asyncio
async def test_open_breaker_short_circuits_with_breaker_open() -> None:
    b = _make_breaker(failure_threshold=1)

    async def boom():
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        await b.call(boom)
    assert b.state == "open"

    with pytest.raises(cb.BreakerOpen):
        await b.call(boom)


@pytest.mark.asyncio
async def test_call_timeout_triggers_failure_count() -> None:
    b = _make_breaker(failure_threshold=2, call_timeout=0.05)

    async def slow():
        await asyncio.sleep(1.0)

    with pytest.raises((asyncio.TimeoutError, cb.BreakerTimeout)):
        await b.call(slow)
    assert b.failure_count == 1


@pytest.mark.asyncio
async def test_half_open_allows_probe_and_recovers() -> None:
    b = _make_breaker(failure_threshold=1, reset_timeout=0.05)

    async def boom():
        raise RuntimeError("boom")

    async def ok():
        return "ok"

    with pytest.raises(RuntimeError):
        await b.call(boom)
    assert b.state == "open"

    await asyncio.sleep(0.1)
    # half_open probe
    result = await b.call(ok)
    assert result == "ok"
    assert b.state == "closed"


@pytest.mark.asyncio
async def test_decorator_form_preserves_signature() -> None:
    @cb.circuit_breaker(name="dec", failure_threshold=1, call_timeout=8.0)
    async def my_hook(x: int) -> int:
        return x * 2

    assert await my_hook(21) == 42


@pytest.mark.asyncio
async def test_named_breakers_isolated() -> None:
    """Failing breaker 'a' must not poison breaker 'b'."""
    a = _make_breaker("a", failure_threshold=1)
    b = _make_breaker("b", failure_threshold=1)

    async def boom():
        raise RuntimeError("boom")

    async def ok():
        return "ok"

    with pytest.raises(RuntimeError):
        await a.call(boom)
    assert a.state == "open"
    assert b.state == "closed"
    assert await b.call(ok) == "ok"
