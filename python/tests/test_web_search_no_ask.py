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
    kinds = [(t.type, t.agent_kind) for t in plan.tasks]
    assert any(k == RunTaskType.AGENT and ak == "web_search" for k, ak in kinds)
    assert kinds[-1][0] == RunTaskType.LLM_STREAM


def test_web_search_agent_never_prompts_ask() -> None:
    run_task = RunTaskSpec(
        id="rt-web-search",
        title="Search the web",
        type=RunTaskType.AGENT,
        agent_kind="web_search",
        params={"inter_agent_handoff": True, "prior_agent_kind": "vault_rag"},
    )
    needs, _msg, _meta = resolve_agent_ask_prompt(run_task, None)
    assert needs is False
