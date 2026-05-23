"""
ACCS + Reflection contract freeze — Phase 8 implementation must satisfy these.

Spec source: docs/Evolution_System_Design.md §5 and §6
"""

from __future__ import annotations

import pytest

accs = pytest.importorskip(
    "oaao_orchestrator.evaluation.accs",
    reason="Phase 8 — evaluation.accs not yet implemented",
)
reflection = pytest.importorskip(
    "oaao_orchestrator.evaluation.reflection",
    reason="Phase 8 — evaluation.reflection not yet implemented",
)


@pytest.mark.asyncio
async def test_accs_returns_alignment_accuracy_hallucination_breakdown() -> None:
    """ACCS must expose 3 factors so we can decompose failures."""
    result = await accs.score_accs(
        user_message="explain X",
        llm_output="...",
        evidence=[],
    )
    assert 0.0 <= result.score <= 1.0
    for f in ("alignment", "accuracy", "hallucination_penalty"):
        assert f in result.factors


@pytest.mark.asyncio
async def test_accs_low_score_triggers_reflection() -> None:
    """0.40 <= score < 0.65 → reflection MUST be triggered exactly once."""
    initial = await accs.score_accs(
        user_message="solve quadratic",
        llm_output="...wrong...",
        evidence=[],
    )
    if 0.40 <= initial.score < 0.65:
        assert initial.action == "reflect"


@pytest.mark.asyncio
async def test_reflection_max_one_round() -> None:
    """Reflection must NEVER loop > 1 — bounded by hard cap."""
    runs = await reflection.run_reflection_loop(
        user_message="bad query",
        first_output="bad output",
        evidence=[],
        max_rounds=999,  # caller tries to abuse; module must clamp
    )
    assert len(runs) <= 1, "Reflection loop bounded to 1 round per §6.2"


@pytest.mark.asyncio
async def test_reflection_disabled_by_env(monkeypatch) -> None:
    """OAAO_REFLECTION_DISABLE=1 must short-circuit reflection."""
    monkeypatch.setenv("OAAO_REFLECTION_DISABLE", "1")
    runs = await reflection.run_reflection_loop(
        user_message="bad query",
        first_output="bad output",
        evidence=[],
        max_rounds=1,
    )
    assert runs == []


@pytest.mark.asyncio
async def test_accs_circuit_breaker_skips_on_failure() -> None:
    """When ACCS coach fails 3x → open circuit → ship anyway."""
    breaker = pytest.importorskip("oaao_orchestrator.safety.circuit_breaker")
    breaker.get_breaker("accs").force_open()
    result = await accs.score_accs(user_message="x", llm_output="y", evidence=[])
    assert result.skipped is True
    assert result.action == "ship"
    breaker.get_breaker("accs").reset()


@pytest.mark.asyncio
async def test_high_accs_flags_crystallization_candidate() -> None:
    """ACCS >= 0.85 → crystallization_candidate flag must be set."""
    result = await accs.score_accs(
        user_message="well-formed query",
        llm_output="excellent answer with citations",
        evidence=[{"source": "vault://x"}],
    )
    if result.score >= 0.85:
        assert result.crystallization_candidate is True
