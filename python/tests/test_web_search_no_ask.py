"""Web search must run without agent-ask confirmation."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.agent_phase_handoff import resolve_agent_ask_prompt
from oaao_orchestrator.planner import (
    build_composer_web_fast_plan,
    needs_multi_agent_turn,
)
from oaao_orchestrator.tasks.models import RunTaskSpec, RunTaskType


def test_composer_globe_uses_fast_web_plan_not_multi_agent() -> None:
    req = SimpleNamespace(
        enable_web_search=True,
        vault_auto_rag=False,
        vault_source_refs=[],
        vault_source_ids=[],
        chat_attachments=[],
        slide_designer=None,
        messages=[],
    )
    assert needs_multi_agent_turn(req) is False
    plan = build_composer_web_fast_plan(req)
    assert any(t.type == RunTaskType.WEB_SEARCH for t in plan.tasks)
    assert plan.tasks[-1].type == RunTaskType.LLM_STREAM


def test_web_search_prepare_task_is_not_agent_ask() -> None:
    run_task = RunTaskSpec(
        id="rt-web-search",
        title="Search the web",
        type=RunTaskType.WEB_SEARCH,
    )
    needs, _msg, _meta = resolve_agent_ask_prompt(run_task, None)
    assert needs is False
