"""
IQS contract freeze — Phase 8 implementation must satisfy these.

Module `oaao_orchestrator.evaluation.iqs` does not exist yet; tests are skipped
until Phase 8 lands. They serve as **spec** (read these to know what to build).

Spec source: docs/Evolution_System_Design.md §4
"""

from __future__ import annotations

import pytest

iqs = pytest.importorskip(
    "oaao_orchestrator.evaluation.iqs",
    reason="Phase 8 — evaluation.iqs not yet implemented",
)


@pytest.mark.asyncio
async def test_iqs_returns_score_and_dimension_breakdown() -> None:
    """IQS must expose 4-dimension breakdown so Daily Report can analyse killers."""
    result = await iqs.score_iqs(user_message="幫我做個東西", conversation_history=[])
    assert 0.0 <= result.score <= 1.0
    for d in ("clarity", "specificity", "actionability", "context_completeness"):
        assert d in result.dimensions
        assert 0.0 <= result.dimensions[d] <= 1.0


@pytest.mark.asyncio
async def test_iqs_low_score_triggers_clarification() -> None:
    """Score < 0.50 → clarification questions must be generated."""
    result = await iqs.score_iqs(user_message="嗯", conversation_history=[])
    if result.score < 0.50:
        assert result.action == "clarify"
        assert len(result.clarification_questions) >= 1


@pytest.mark.asyncio
async def test_iqs_high_score_passes_through() -> None:
    """Score >= 0.80 → action must be 'pass'."""
    result = await iqs.score_iqs(
        user_message="把附件 PDF 第 3 頁的表格轉成 Markdown，保留欄位順序",
        conversation_history=[],
    )
    if result.score >= 0.80:
        assert result.action == "pass"
        assert result.clarification_questions == []


@pytest.mark.asyncio
async def test_iqs_circuit_breaker_skips_on_failure(monkeypatch) -> None:
    """When coach fails 3 times in a row, IQS must skip (not block user)."""
    breaker = pytest.importorskip("oaao_orchestrator.safety.circuit_breaker")
    # Force open state
    breaker.get_breaker("iqs").force_open()
    result = await iqs.score_iqs(user_message="anything", conversation_history=[])
    assert result.skipped is True
    assert result.action == "pass"
    breaker.get_breaker("iqs").reset()


@pytest.mark.asyncio
async def test_iqs_uses_geometric_mean_not_arithmetic() -> None:
    """A single 0.05-clipped dimension must pull the overall down sharply."""
    # 0.95 × 0.95 × 0.95 × 0.05^0.20 ≈ 0.45 (geo) vs ≈ 0.73 (arith)
    result = iqs.combine_dimensions(
        clarity=0.95, specificity=0.95, actionability=0.95, context_completeness=0.0
    )
    assert result < 0.55, "IQS must use weighted geometric mean per §4.2"
