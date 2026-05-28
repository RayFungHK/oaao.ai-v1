"""CS-2-S11 — library soft-RAG isolation + attach hit regression tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from oaao_orchestrator.agents.library_search import LibrarySearchAgent
from oaao_orchestrator.library.planner_attach import (
    inject_library_search_when_attached,
    library_doc_ids_from_request,
)
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.planner import build_fast_chat_plan
from oaao_orchestrator.tasks.models import RunTaskSpec, RunTaskType


class _Req:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


def test_library_doc_ids_empty():
    assert library_doc_ids_from_request(_Req(library_doc_ids=[])) == []
    assert library_doc_ids_from_request(_Req()) == []


def test_inject_library_search_when_attached():
    specs = [
        RunTaskSpec(id="rt-llm-stream", title="Compose", type=RunTaskType.LLM_STREAM),
    ]
    req = _Req(library_doc_ids=[10, 20])
    out = inject_library_search_when_attached(specs, req)
    kinds = [s.agent_kind for s in out if s.type == RunTaskType.AGENT]
    assert kinds == ["library_search"]
    assert out[0].agent_kind == "library_search"
    assert out[-1].type == RunTaskType.LLM_STREAM


def test_no_inject_without_attach():
    specs = [
        RunTaskSpec(id="rt-vault-rag", title="Vault", type=RunTaskType.VAULT_RAG),
        RunTaskSpec(id="rt-llm-stream", title="Compose", type=RunTaskType.LLM_STREAM),
    ]
    req = _Req(library_doc_ids=[], vault_auto_rag=True)
    out = inject_library_search_when_attached(specs, req)
    assert not any(s.agent_kind == "library_search" for s in out)


def test_fast_chat_plan_includes_library_only_when_attached():
    with_lib = build_fast_chat_plan(_Req(library_doc_ids=[5], vault_auto_rag=False))
    without = build_fast_chat_plan(_Req(library_doc_ids=[], vault_auto_rag=True))
    assert any(t.agent_kind == "library_search" for t in with_lib.tasks)
    assert not any(t.agent_kind == "library_search" for t in without.tasks)


@pytest.mark.asyncio
async def test_library_search_agent_skips_without_attach():
    agent = LibrarySearchAgent()
    ctx = RunContext(
        conversation_id="1",
        messages=[{"role": "user", "content": "summarize attached doc"}],
        extra={"chat_request": _Req(library_doc_ids=[], tenant_id=1)},
    )
    run_task = RunTaskSpec(id="rt-lib", title="Library", type=RunTaskType.AGENT, agent_kind="library_search")
    result = await agent.run(run=AsyncMock(), run_task=run_task, ctx=ctx)
    assert result.success is True
    assert result.extra.get("library_search_skipped") is True


@pytest.mark.asyncio
async def test_library_search_agent_injects_hits_when_attached():
    agent = LibrarySearchAgent()
    ctx = RunContext(
        conversation_id="1",
        messages=[{"role": "user", "content": "what does the handbook say?"}],
        extra={"chat_request": _Req(library_doc_ids=[42], tenant_id=7)},
    )
    run_task = RunTaskSpec(id="rt-lib", title="Library", type=RunTaskType.AGENT, agent_kind="library_search")
    fake_hits = [{"title": "Handbook", "text": "Policy excerpt", "document_id": 42, "score": 0.9}]
    run = AsyncMock()
    run.cancelled = False

    with patch(
        "oaao_orchestrator.agents.library_search.run_library_search",
        new_callable=AsyncMock,
        return_value={"ok": True, "hits": fake_hits},
    ):
        with patch("oaao_orchestrator.agents.library_search.emit_agent_start", new_callable=AsyncMock):
            with patch("oaao_orchestrator.agents.library_search.emit_agent_end", new_callable=AsyncMock):
                result = await agent.run(run=run, run_task=run_task, ctx=ctx)

    assert result.success is True
    system_msgs = [
        m for m in ctx.messages if isinstance(m, dict) and m.get("role") == "system"
    ]
    assert any("Library document excerpts" in str(m.get("content") or "") for m in system_msgs)


def test_planner_output_carries_apply_skill_ids():
    from oaao_orchestrator.planner_llm import PlannerOutputDraft, PlannerTaskDraft, planner_output_to_run_plan

    draft = PlannerOutputDraft(
        tasks=[
            PlannerTaskDraft(id="rt-llm-stream", title="Compose", type="llm_stream"),
        ],
        apply_skill_ids=["conversation:abc", "bound_template:tid-1"],
    )
    plan = planner_output_to_run_plan(
        draft,
        allowed_agents=[],
        require_vault=False,
        require_attachments=False,
    )
    assert plan.apply_skill_ids == ["conversation:abc", "bound_template:tid-1"]
