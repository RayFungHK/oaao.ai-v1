"""Public-web routing — Auto Source must not schedule vault_rag ahead of web_search."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.planner import (
    build_composer_web_fast_plan,
    finalize_public_web_plan,
    strip_vault_rag_for_public_web,
)
from oaao_orchestrator.tasks.models import RunTaskType


def test_composer_web_fast_plan_omits_vault_rag_with_auto_source() -> None:
    req = SimpleNamespace(
        vault_auto_rag=True,
        enable_web_search=True,
        chat_attachments=[],
        messages=[{"role": "user", "content": "DJI Pocket 4 Pro 開售"}],
        allowed_agents=["web_search", "vault_rag"],
    )
    plan = build_composer_web_fast_plan(req)
    types = [t.type for t in plan.tasks]
    assert RunTaskType.VAULT_RAG not in types
    assert any(t.type == RunTaskType.AGENT and t.agent_kind == "web_search" for t in plan.tasks)


def test_strip_vault_when_turn_intent_web() -> None:
    req = SimpleNamespace(
        vault_auto_rag=True,
        enable_web_search=False,
        turn_intent={"needs_web_search": True},
        allowed_agents=["web_search"],
    )
    from oaao_orchestrator.tasks.models import RunTaskSpec

    specs = [
        RunTaskSpec(id="rt-vault-rag", title="Search knowledge base", type=RunTaskType.VAULT_RAG),
        RunTaskSpec(id="rt-llm-stream", title="Compose reply", type=RunTaskType.LLM_STREAM),
    ]
    out = strip_vault_rag_for_public_web(specs, req)
    assert all(s.type != RunTaskType.VAULT_RAG for s in out)


def test_finalize_public_web_injects_web_search() -> None:
    from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec

    req = SimpleNamespace(
        enable_web_search=True,
        allowed_agents=["web_search"],
    )
    plan = RunPlan(
        tasks=[
            RunTaskSpec(id="rt-vault-rag", title="KB", type=RunTaskType.VAULT_RAG),
            RunTaskSpec(id="rt-llm-stream", title="Compose", type=RunTaskType.LLM_STREAM),
        ],
        abilities=[],
    )
    out = finalize_public_web_plan(plan, req, allowed_agents=["web_search"])
    assert not any(t.type == RunTaskType.VAULT_RAG for t in out.tasks)
    assert any(t.agent_kind == "web_search" for t in out.tasks)
