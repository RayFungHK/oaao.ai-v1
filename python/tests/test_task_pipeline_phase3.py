"""Phase 3 — VaultRagAgent + agent_task SSE frames."""

from __future__ import annotations

from typing import Any

import pytest
from oaao_orchestrator.agents.registry import get_agent_registry, reset_agent_registry_for_tests
from oaao_orchestrator.agents.vault_rag import VaultRagAgent
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.events import KIND_PROGRESS, PHASE_RAG
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskStatus, RunTaskType
from oaao_orchestrator.tasks.stream_emit import (
    agent_view_for_run_task,
    ensure_run_task_agent_kind,
    resolve_run_task_agent_kind,
)
from oaao_orchestrator.vault_graph_rag import VaultRagCitation, VaultRagOutcome


@pytest.fixture(autouse=True)
def _fresh_registry() -> None:
    reset_agent_registry_for_tests()


def test_run_task_agent_kind_and_view() -> None:
    spec = RunTaskSpec(id="rt-vault-rag", title="Search", type=RunTaskType.VAULT_RAG)
    assert resolve_run_task_agent_kind(spec) == "vault_rag"
    ensure_run_task_agent_kind(spec)
    assert spec.agent_kind == "vault_rag"
    spec.status = RunTaskStatus.ACTIVE
    view = agent_view_for_run_task(spec)
    assert view is not None
    assert view["kind"] == "vault_rag"
    assert view["status"] == "running"


def test_vault_rag_agent_registered() -> None:
    reg = get_agent_registry()
    assert "vault_rag" in reg.kinds()
    assert reg.get("vault_rag") is not None


@pytest.mark.asyncio
async def test_vault_rag_agent_emits_agent_tasks(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_augment(
        messages: list[dict[str, Any]],
        vault_retrieval_profiles: list[dict[str, Any]] | None,
        **kwargs: Any,
    ) -> VaultRagOutcome:
        _ = vault_retrieval_profiles, kwargs
        messages.insert(0, {"role": "system", "content": "vault grounding"})
        return VaultRagOutcome(
            passage_count=2,
            profile_hits=1,
            detail_lines=["doc-a"],
            citation_refs=[
                VaultRagCitation(vault_id=1, document_id=10, file_name="a.pdf"),
            ],
        )

    def _fake_snapshot(outcome: VaultRagOutcome, base: dict[str, Any]) -> dict[str, Any]:
        snap = dict(base)
        snap["blocks"] = [{"type": "rag_citations", "props": {"references": []}}]
        snap["vault_rag"] = {"passage_count": outcome.passage_count}
        return snap

    monkeypatch.setattr(
        "oaao_orchestrator.agents.vault_rag.augment_chat_messages_for_vault_rag",
        _fake_augment,
    )
    monkeypatch.setattr(
        "oaao_orchestrator.agents.vault_rag.build_pipeline_snapshot_for_rag",
        _fake_snapshot,
    )

    run = StreamRun("phase3-vault-rag")
    plan = RunPlan(
        tasks=[
            RunTaskSpec(
                id="rt-vault-rag",
                title="Search knowledge base",
                type=RunTaskType.VAULT_RAG,
                index=1,
                total=2,
            ),
        ],
    )
    run_task = plan.tasks[0]
    ctx = RunContext(
        messages=[{"role": "user", "content": "summarize Q3"}],
        extra={
            "vault_rag": {
                "vault_retrieval_profiles": [{"vault_id": 1, "qdrant_collection": "v1"}],
                "pipeline_snap_base": {},
            },
            "run_plan": plan,
        },
    )

    agent = VaultRagAgent()
    result = await agent.run(run=run, run_task=run_task, ctx=ctx)

    assert result.success is True
    assert ctx.messages[0]["role"] == "system"
    assert isinstance(result.extra.get("pipeline_snap"), dict)
    progress = [
        e
        for _, e in run._events
        if e.phase == PHASE_RAG
        and e.kind == KIND_PROGRESS
        and isinstance(e.payload.get("agent_task"), dict)
    ]
    assert len(progress) >= 1
    titles = {str(p.payload["agent_task"].get("title") or "") for p in progress}
    assert "Search knowledge base" in titles
