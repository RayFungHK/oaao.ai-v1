"""Phase 1 — default run plan + stream payload helpers."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.planner import build_default_run_plan
from oaao_orchestrator.tasks.models import RunTaskType


def test_plan_llm_only_when_no_vault_or_attachments() -> None:
    req = SimpleNamespace(
        vault_auto_rag=False,
        vault_source_refs=[],
        vault_source_ids=[],
        vault_scope_documents={},
        chat_attachments=[],
    )
    plan = build_default_run_plan(req)
    assert len(plan.tasks) == 1
    assert plan.tasks[0].type == RunTaskType.LLM_STREAM


def test_plan_includes_vault_and_attachments() -> None:
    req = SimpleNamespace(
        vault_auto_rag=True,
        vault_source_refs=[{"kind": "vault", "id": 1, "vault_id": 1}],
        vault_source_ids=[1],
        vault_scope_documents={},
        chat_attachments=[{"id": 1}],
    )
    plan = build_default_run_plan(req)
    types = [t.type for t in plan.tasks]
    assert types == [RunTaskType.VAULT_RAG, RunTaskType.ATTACHMENTS, RunTaskType.LLM_STREAM]
    assert plan.tasks[0].index == 1
    assert plan.tasks[-1].total == 3
