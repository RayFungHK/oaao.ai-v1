"""Composer globe (enable_web_search) plan enrichment — no keyword routing."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.planner_llm import enrich_composer_web_search_plan
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType


def test_enrich_noop_without_composer_web_toggle() -> None:
    req = SimpleNamespace(
        enable_web_search=False,
        messages=[{"role": "user", "content": "網絡上有沒有 DJI Pocket 4 Pro 開售消息？"}],
    )
    plan = RunPlan(
        tasks=[
            RunTaskSpec(id="rt-vault-rag", title="Search knowledge base", type=RunTaskType.VAULT_RAG),
            RunTaskSpec(id="rt-llm-stream", title="Generate response", type=RunTaskType.LLM_STREAM),
        ],
    )
    out = enrich_composer_web_search_plan(plan, req, allowed_agents=["web_search"])
    assert [t.type for t in out.tasks] == [RunTaskType.VAULT_RAG, RunTaskType.LLM_STREAM]


def test_enrich_injects_web_when_globe_enabled() -> None:
    req = SimpleNamespace(
        enable_web_search=True,
        messages=[{"role": "user", "content": "hello"}],
    )
    plan = RunPlan(
        tasks=[
            RunTaskSpec(id="rt-llm-stream", title="Compose reply", type=RunTaskType.LLM_STREAM),
        ],
    )
    out = enrich_composer_web_search_plan(plan, req, allowed_agents=["web_search"])
    kinds = [t.agent_kind for t in out.tasks if t.type == RunTaskType.AGENT]
    assert kinds == ["web_search"]
