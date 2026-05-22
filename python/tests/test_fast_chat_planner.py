"""Fast chat planner — skip LLM planner for normal Q&A."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.planner import (
    build_fast_chat_plan,
    needs_multi_agent_turn,
)
from oaao_orchestrator.slide_project.teaching_intent import (
    text_signals_personal_record_lookup,
    text_signals_vault_grounding,
)
from oaao_orchestrator.tasks.models import RunTaskType


def test_needs_multi_agent_turn_false_for_wallet_recall() -> None:
    req = SimpleNamespace(
        enable_web_search=False,
        chat_attachments=[],
        slide_designer=None,
        messages=[{"role": "user", "content": "之前是有記錄錢包的用法？"}],
    )
    assert needs_multi_agent_turn(req) is False


def test_fast_plan_wallet_query_includes_vault_rag() -> None:
    req = SimpleNamespace(
        vault_auto_rag=False,
        vault_source_refs=[],
        vault_source_ids=[],
        vault_scope_documents={},
        chat_attachments=[],
        messages=[{"role": "user", "content": "之前是有記錄錢包的用法？"}],
    )
    assert text_signals_personal_record_lookup("之前是有記錄錢包的用法？")
    assert text_signals_vault_grounding("之前是有記錄錢包的用法？")
    plan = build_fast_chat_plan(req)
    types = [t.type for t in plan.tasks]
    assert RunTaskType.VAULT_RAG in types
    assert RunTaskType.LLM_STREAM in types
    assert not any(t.type == RunTaskType.AGENT for t in plan.tasks)


def test_fast_plan_fourier_without_vault_is_compose_only() -> None:
    req = SimpleNamespace(
        vault_auto_rag=False,
        vault_source_refs=[],
        vault_source_ids=[],
        vault_scope_documents={},
        chat_attachments=[],
        messages=[{"role": "user", "content": "什麼是傅立葉轉換"}],
    )
    plan = build_fast_chat_plan(req)
    assert [t.type for t in plan.tasks] == [RunTaskType.LLM_STREAM]
