"""
KV pool concurrency contract — Phase 8/10 must satisfy.

This test uses a MOCK vLLM endpoint to exercise the budget logic; it does NOT
spin up a real model. Pure logic test (CI-safe, no GPU).

Spec source: docs/Audit_Report.md §7.3 (KV 池佔用 > 34GB → 503 retry-after=2s)
"""

from __future__ import annotations

import asyncio

import pytest

kv = pytest.importorskip(
    "oaao_orchestrator.safety.kv_pool_guard",
    reason="Phase 8 — safety.kv_pool_guard not yet implemented",
)


def _has(fn_name: str) -> bool:
    return hasattr(kv, fn_name)


@pytest.mark.skipif(not _has("check_kv_budget"), reason="check_kv_budget not yet defined")
def test_kv_budget_under_threshold_accepts() -> None:
    decision = kv.check_kv_budget(used_gb=20.0, pool_max_gb=40.0)
    assert decision.allow is True


@pytest.mark.skipif(not _has("check_kv_budget"), reason="check_kv_budget not yet defined")
def test_kv_budget_over_threshold_rejects_with_retry_after() -> None:
    """> 85% utilization → reject with retry-after=2s."""
    decision = kv.check_kv_budget(used_gb=35.0, pool_max_gb=40.0)
    assert decision.allow is False
    assert decision.retry_after_seconds == 2
    assert decision.http_status == 503


@pytest.mark.skipif(not _has("check_kv_budget"), reason="check_kv_budget not yet defined")
def test_threshold_is_exactly_85_percent() -> None:
    """Boundary: exactly 85% → reject; just below → allow."""
    pool = 40.0
    just_below = kv.check_kv_budget(used_gb=pool * 0.849, pool_max_gb=pool)
    at_threshold = kv.check_kv_budget(used_gb=pool * 0.85, pool_max_gb=pool)
    assert just_below.allow is True
    assert at_threshold.allow is False


@pytest.mark.asyncio
@pytest.mark.skipif(not _has("guarded_call"), reason="guarded_call decorator not yet defined")
async def test_guarded_call_returns_503_when_pool_full(monkeypatch) -> None:
    monkeypatch.setattr(kv, "_current_kv_usage_gb", lambda: 36.0)
    monkeypatch.setattr(kv, "_pool_max_gb", lambda: 40.0)

    @kv.guarded_call
    async def my_llm_hook():
        return "ok"

    with pytest.raises(kv.KvPoolFull) as ei:
        await my_llm_hook()
    assert ei.value.retry_after_seconds == 2


@pytest.mark.asyncio
@pytest.mark.skipif(not _has("guarded_call"), reason="guarded_call decorator not yet defined")
async def test_concurrency_decreases_available_budget(monkeypatch) -> None:
    """Concurrent in-flight requests must reserve budget (no double-spend)."""
    state = {"in_flight": 0}

    def usage():
        # each in-flight reserves 2GB
        return 30.0 + state["in_flight"] * 2.0

    monkeypatch.setattr(kv, "_current_kv_usage_gb", usage)
    monkeypatch.setattr(kv, "_pool_max_gb", lambda: 40.0)

    @kv.guarded_call
    async def my_llm_hook():
        state["in_flight"] += 1
        try:
            await asyncio.sleep(0.05)
        finally:
            state["in_flight"] -= 1
        return "ok"

    # 1st call: usage 30GB allowed; 2nd: usage 32GB allowed; 3rd: usage 34GB still allowed (85% line)
    # 4th: usage 36GB → reject
    results = await asyncio.gather(
        my_llm_hook(),
        my_llm_hook(),
        my_llm_hook(),
        my_llm_hook(),
        return_exceptions=True,
    )
    rejects = [r for r in results if isinstance(r, kv.KvPoolFull)]
    assert len(rejects) >= 1, "At least one concurrent call must be rejected at budget edge"
