"""L-ED-6 — @library attach → library_search → system context E2E chain (contract level)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from oaao_orchestrator.agents.library_search import LibrarySearchAgent
from oaao_orchestrator.library.blocks import blocks_to_markdown
from oaao_orchestrator.library.planner_attach import inject_library_search_when_attached
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.planner import build_fast_chat_plan
from oaao_orchestrator.tasks.models import RunTaskSpec, RunTaskType


class _Req:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


def test_l_ed_6_blocks_to_markdown_then_search_payload_shape():
    blocks = [
        {"type": "heading", "level": 2, "content": "Policy"},
        {"type": "paragraph", "content": "Remote work is allowed on Fridays."},
    ]
    md = blocks_to_markdown(blocks, title="Handbook")
    assert "Remote work" in md
    assert "# Handbook" in md


def test_l_ed_6_fast_plan_injects_library_search_before_compose():
    plan = build_fast_chat_plan(_Req(library_doc_ids=[99], vault_auto_rag=False))
    kinds = [t.agent_kind for t in plan.tasks if t.type == RunTaskType.AGENT]
    assert kinds[0] == "library_search"
    assert plan.tasks[-1].type == RunTaskType.LLM_STREAM


@pytest.mark.asyncio
async def test_l_ed_6_attached_library_injects_rag_excerpts_into_messages():
    agent = LibrarySearchAgent()
    ctx = RunContext(
        conversation_id="42",
        messages=[{"role": "user", "content": '@library what does the handbook say about remote work?'}],
        extra={"chat_request": _Req(library_doc_ids=[7], tenant_id=3, workspace_id=1)},
    )
    run_task = RunTaskSpec(id="rt-lib", title="Library", type=RunTaskType.AGENT, agent_kind="library_search")
    hits = [
        {
            "title": "Handbook",
            "text": "Remote work is allowed on Fridays.",
            "document_id": 7,
            "score": 0.91,
        },
    ]
    run = AsyncMock()
    run.cancelled = False

    with patch(
        "oaao_orchestrator.agents.library_search.run_library_search",
        new_callable=AsyncMock,
        return_value={"ok": True, "hits": hits},
    ):
        with patch("oaao_orchestrator.agents.library_search.emit_agent_start", new_callable=AsyncMock):
            with patch("oaao_orchestrator.agents.library_search.emit_agent_end", new_callable=AsyncMock):
                result = await agent.run(run=run, run_task=run_task, ctx=ctx)

    assert result.success is True
    injected = [
        m
        for m in ctx.messages
        if isinstance(m, dict) and m.get("role") == "system" and "Library document excerpts" in str(m.get("content") or "")
    ]
    assert len(injected) >= 1
    assert "Remote work" in injected[0]["content"]
    assert "Handbook" in injected[0]["content"] or "doc#7" in injected[0]["content"]


def test_l_ed_6_inject_preserves_llm_stream_order():
    specs = [RunTaskSpec(id="rt-llm", title="Compose", type=RunTaskType.LLM_STREAM)]
    out = inject_library_search_when_attached(specs, _Req(library_doc_ids=[1]))
    assert out[0].agent_kind == "library_search"
    assert out[1].type == RunTaskType.LLM_STREAM
