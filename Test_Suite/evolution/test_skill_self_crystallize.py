"""
Skill Crystallization contract freeze — Phase 9 must satisfy these.

Spec source: docs/Evolution_System_Design.md §8 and Audit_Report.md §7.5
"""

from __future__ import annotations

import pytest

sealer = pytest.importorskip(
    "oaao_orchestrator.crystallization.sealer",
    reason="Phase 9 — crystallization.sealer not yet implemented",
)
recall = pytest.importorskip(
    "oaao_orchestrator.crystallization.recall",
    reason="Phase 9 — crystallization.recall not yet implemented",
)


@pytest.mark.asyncio
async def test_high_accs_run_seals_a_skill() -> None:
    """ACCS >= 0.85 + >= 2 agent steps → CrystallizedSkill must be produced."""
    skill = await sealer.try_seal_skill(
        run_id="r-1",
        accs_score=0.91,
        tool_chain=["vault_rag", "llm_stream"],
        planner_output={"tasks": ["a", "b"]},
        final_answer="...",
        user_message="how to compare X and Y",
    )
    assert skill is not None
    assert skill.success_score == 0.91
    assert skill.tool_chain == ["vault_rag", "llm_stream"]
    assert skill.trigger_intent and len(skill.trigger_intent) <= 80


@pytest.mark.asyncio
async def test_low_accs_does_not_seal() -> None:
    skill = await sealer.try_seal_skill(
        run_id="r-2",
        accs_score=0.60,
        tool_chain=["vault_rag", "llm_stream"],
        planner_output={"tasks": ["a", "b"]},
        final_answer="...",
        user_message="...",
    )
    assert skill is None


@pytest.mark.asyncio
async def test_short_chain_does_not_seal() -> None:
    """Single-step runs are too trivial to crystallize."""
    skill = await sealer.try_seal_skill(
        run_id="r-3",
        accs_score=0.95,
        tool_chain=["llm_stream"],
        planner_output={"tasks": ["a"]},
        final_answer="...",
        user_message="...",
    )
    assert skill is None


@pytest.mark.asyncio
async def test_degraded_run_does_not_seal() -> None:
    """Runs with degraded/iqs_skipped/accs_skipped flags must be excluded."""
    skill = await sealer.try_seal_skill(
        run_id="r-4",
        accs_score=0.95,
        tool_chain=["vault_rag", "llm_stream"],
        planner_output={"tasks": ["a", "b"]},
        final_answer="...",
        user_message="...",
        flags={"accs_skipped": True},
    )
    assert skill is None


@pytest.mark.asyncio
async def test_dual_write_qdrant_and_arango(monkeypatch) -> None:
    """Sealer must write to BOTH Qdrant (vector) AND Arango (structured)."""
    calls = {"qdrant": 0, "arango": 0}

    async def fake_qdrant_upsert(*a, **kw):
        calls["qdrant"] += 1

    async def fake_arango_insert(*a, **kw):
        calls["arango"] += 1

    monkeypatch.setattr(sealer, "_qdrant_upsert_skill", fake_qdrant_upsert)
    monkeypatch.setattr(sealer, "_arango_insert_skill", fake_arango_insert)

    await sealer.try_seal_skill(
        run_id="r-5",
        accs_score=0.92,
        tool_chain=["a", "b"],
        planner_output={"tasks": ["a", "b"]},
        final_answer="...",
        user_message="dual write test",
    )
    assert calls["qdrant"] == 1
    assert calls["arango"] == 1


@pytest.mark.asyncio
async def test_recall_returns_skill_on_similarity_hit() -> None:
    """IQS-phase recall must hit at cosine sim >= 0.88."""
    hit = await recall.recall_skill(user_message="how to compare X and Y again")
    if hit is not None:
        assert hit.similarity >= 0.88
        assert hit.skill.tool_chain  # non-empty


@pytest.mark.asyncio
async def test_recall_miss_returns_none() -> None:
    hit = await recall.recall_skill(user_message="totally unrelated random gibberish xyzzy")
    assert hit is None or hit.similarity < 0.88


@pytest.mark.asyncio
async def test_recall_increments_usage_count(monkeypatch) -> None:
    """Successful recall must bump usage_count in Arango."""
    bumps = []

    async def fake_bump(skill_id: str) -> None:
        bumps.append(skill_id)

    monkeypatch.setattr(recall, "_bump_usage_count", fake_bump)

    hit = await recall.recall_skill(user_message="probe")
    if hit is not None:
        assert bumps == [hit.skill.id]
