"""Crystallization vault sync contracts — Phase 9."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from oaao_orchestrator.crystallization.param_template import extract_param_template
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType


def test_param_template_extracts_task_params() -> None:
    plan = RunPlan(
        tasks=[
            RunTaskSpec(
                id="1",
                title="search vault",
                type=RunTaskType.VAULT_RAG,
                params={"top_k": 5},
            ),
            RunTaskSpec(
                id="2",
                title="stream answer",
                type=RunTaskType.LLM_STREAM,
                agent_kind=None,
            ),
        ],
        abilities=[],
        report_after_task_ids=[],
    )
    tmpl = extract_param_template(plan)
    assert len(tmpl.get("tasks") or []) == 2
    assert tmpl["tasks"][0]["params"]["top_k"] == 5


@pytest.mark.asyncio
async def test_sealer_includes_param_template(monkeypatch) -> None:
    sealer = pytest.importorskip("oaao_orchestrator.crystallization.sealer")

    async def noop_ensure():
        return {}

    monkeypatch.setattr(
        "oaao_orchestrator.crystallization.collections.ensure_crystallized_collections",
        noop_ensure,
    )
    monkeypatch.setattr(sealer, "_qdrant_upsert_skill", AsyncMock())
    monkeypatch.setattr(sealer, "_arango_insert_skill", AsyncMock())

    tasks = [
        RunTaskSpec(id="1", title="a", type=RunTaskType.VAULT_RAG, params={"q": "x"}),
        RunTaskSpec(id="2", title="b", type=RunTaskType.LLM_STREAM),
    ]
    skill = await sealer.try_seal_skill(
        run_id="r-param",
        accs_score=0.9,
        tool_chain=["vault_rag", "llm_stream"],
        planner_output={"tasks": ["1", "2"]},
        final_answer="done",
        user_message="how to compare",
        plan_tasks=tasks,
    )
    assert skill is not None
    assert skill.param_template.get("tasks")
    assert skill.param_template["tasks"][0]["params"]["q"] == "x"


@pytest.mark.asyncio
async def test_recall_bumps_arango_usage(monkeypatch) -> None:
    recall = pytest.importorskip("oaao_orchestrator.crystallization.recall")
    sealer = pytest.importorskip("oaao_orchestrator.crystallization.sealer")

    async def noop_ensure():
        return {}

    monkeypatch.setattr(
        "oaao_orchestrator.crystallization.collections.ensure_crystallized_collections",
        noop_ensure,
    )
    monkeypatch.setattr(sealer, "_qdrant_upsert_skill", AsyncMock())
    monkeypatch.setattr(sealer, "_arango_insert_skill", AsyncMock())

    await sealer.try_seal_skill(
        run_id="r-use",
        accs_score=0.9,
        tool_chain=["vault_rag", "llm_stream"],
        planner_output={"tasks": ["a", "b"]},
        final_answer="...",
        user_message="how to compare X and Y",
    )

    bumps: list[str] = []

    async def fake_arango_patch(skill_id: str, *, usage_count: int, last_used_at: str) -> None:
        bumps.append(skill_id)

    monkeypatch.setattr(recall, "_arango_patch_usage", fake_arango_patch)

    hit = await recall.recall_skill(user_message="how to compare X and Y again")
    if hit is not None:
        assert bumps == [hit.skill.id]
