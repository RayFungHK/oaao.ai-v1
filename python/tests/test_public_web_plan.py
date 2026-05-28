"""Public-web routing — Auto Source must not schedule vault_rag ahead of web_search."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from oaao_orchestrator.planner import (
    build_composer_web_fast_plan,
    ensure_web_search_allowed_for_public_web,
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


def test_finalize_public_web_injects_web_search_with_vault_scope_and_globe() -> None:
    from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec

    req = SimpleNamespace(
        enable_web_search=True,
        turn_intent={"needs_web_search": True},
        vault_source_refs=[{"kind": "vault", "id": 1, "vault_id": 1}],
    )
    plan = RunPlan(
        tasks=[
            RunTaskSpec(id="rt-llm-stream", title="Compose", type=RunTaskType.LLM_STREAM),
        ],
        abilities=[],
    )
    out = finalize_public_web_plan(plan, req, allowed_agents=["web_search"])
    assert any(t.agent_kind == "web_search" for t in out.tasks)


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


def test_ensure_web_search_allowed_when_intent_needs_web() -> None:
    req = SimpleNamespace(turn_intent={"needs_web_search": True})
    out = ensure_web_search_allowed_for_public_web(req, ["slide_designer"])
    assert "web_search" in out


def test_ensure_web_search_allowed_when_globe_on() -> None:
    req = SimpleNamespace(enable_web_search=True)
    out = ensure_web_search_allowed_for_public_web(req, ["slide_designer"])
    assert "web_search" in out


def test_composer_web_fast_plan_injects_slide_designer_when_intent_needs_slide() -> None:
    req = SimpleNamespace(
        vault_auto_rag=False,
        enable_web_search=True,
        chat_attachments=[],
        messages=[{"role": "user", "content": "搜索 DJI Pocket 4P 的規格，做一份宣傳 slide"}],
        allowed_agents=["web_search", "slide_designer"],
        turn_intent={"needs_slide_designer": True, "analysis": {"slide_designer": 1.0}},
        slide_designer=None,
    )
    plan = build_composer_web_fast_plan(req)
    kinds = [t.agent_kind for t in plan.tasks if t.agent_kind]
    assert kinds.index("web_search") < kinds.index("slide_designer")
    slide_tasks = [t for t in plan.tasks if t.agent_kind == "slide_designer"]
    assert len(slide_tasks) >= 1
    outline = [t for t in slide_tasks if (t.params or {}).get("slide_phase") == "outline"]
    assert outline and outline[0].params.get("requires_ask") is True
    assert not any(t.type == RunTaskType.LLM_STREAM for t in plan.tasks)


def test_ensure_slide_designer_allowed_when_intent_needs_slide() -> None:
    from oaao_orchestrator.planner import ensure_slide_designer_allowed_for_intent

    req = SimpleNamespace(turn_intent={"needs_slide_designer": True})
    out = ensure_slide_designer_allowed_for_intent(req, ["web_search"])
    assert "slide_designer" in out


def test_build_run_plan_web_fast_includes_slide_when_globe_and_intent(monkeypatch) -> None:
    async def _run() -> None:
        from oaao_orchestrator.agent_intent_hook import AgentIntentSignals
        from oaao_orchestrator.planner import build_run_plan
        from oaao_orchestrator import turn_intent as turn_intent_mod

        async def fake_score(*_args, **_kwargs):
            return AgentIntentSignals(
                needs_web_search=True,
                analysis={"web_search": 1.0, "slide_designer": 0.95},
                reasoning={"slide_designer": "promotional slide"},
            )

        monkeypatch.setattr(turn_intent_mod, "score_turn_intent", fake_score)

        req = SimpleNamespace(
            vault_auto_rag=False,
            enable_web_search=True,
            chat_attachments=[],
            messages=[{"role": "user", "content": "搜索 DJI Pocket 4P 的規格，做一份宣傳 slide"}],
            allowed_agents=["web_search"],
            planner_intent={"base_url": "http://x", "model": "m"},
            planner=None,
            run_planner_mode="stub",
            slide_designer=None,
            endpoint=SimpleNamespace(knowledge_cutoff="2025-01-01", config={}),
        )
        plan = await build_run_plan(req, chat_completions_url="http://x/v1", api_key=None, model="x")
        assert any(t.agent_kind == "web_search" for t in plan.tasks)
        assert any(t.agent_kind == "slide_designer" for t in plan.tasks)
        assert req.turn_intent["needs_slide_designer"] is True

    asyncio.run(_run())


def test_composer_web_fast_plan_injects_slide_on_globe_and_slide_message() -> None:
    req = SimpleNamespace(
        vault_auto_rag=False,
        enable_web_search=True,
        chat_attachments=[],
        messages=[{"role": "user", "content": "搜索 DJI Pocket 4P 的規格，做一份宣傳 slide"}],
        allowed_agents=["web_search"],
        turn_intent={"needs_slide_designer": True, "analysis": {"slide_designer": 1.0}},
        slide_designer=None,
    )
    plan = build_composer_web_fast_plan(req)
    kinds = [t.agent_kind for t in plan.tasks if t.agent_kind]
    assert "web_search" in kinds
    assert "slide_designer" in kinds
    assert kinds.index("web_search") < kinds.index("slide_designer")
    assert not any(t.type == RunTaskType.LLM_STREAM for t in plan.tasks)


def test_composer_web_fast_plan_keeps_compose_when_no_slide() -> None:
    req = SimpleNamespace(
        vault_auto_rag=False,
        enable_web_search=True,
        chat_attachments=[],
        messages=[{"role": "user", "content": "DJI Pocket 4 Pro 開售"}],
        allowed_agents=["web_search"],
        turn_intent={"needs_web_search": True},
        slide_designer=None,
    )
    plan = build_composer_web_fast_plan(req)
    assert any(t.type == RunTaskType.LLM_STREAM for t in plan.tasks)
    assert not any(t.agent_kind == "slide_designer" for t in plan.tasks)


def test_build_run_plan_globe_injects_slide_without_intent_llm(monkeypatch) -> None:
    async def _run() -> None:
        from oaao_orchestrator.planner import build_run_plan
        from oaao_orchestrator import turn_intent as turn_intent_mod

        async def fake_score(*_args, **_kwargs):
            return None

        monkeypatch.setattr(turn_intent_mod, "score_turn_intent", fake_score)

        req = SimpleNamespace(
            vault_auto_rag=False,
            enable_web_search=True,
            chat_attachments=[],
            messages=[{"role": "user", "content": "搜索 DJI Pocket 4P 的規格，做一份宣傳 slide"}],
            allowed_agents=["web_search"],
            planner_intent=None,
            planner=None,
            run_planner_mode="stub",
            slide_designer=None,
            endpoint=SimpleNamespace(knowledge_cutoff="2025-01-01", config={}),
        )
        plan = await build_run_plan(req, chat_completions_url="http://x/v1", api_key=None, model="x")
        assert any(t.agent_kind == "web_search" for t in plan.tasks)
        assert any(t.agent_kind == "slide_designer" for t in plan.tasks)
        assert req.turn_intent["needs_slide_designer"] is True

    asyncio.run(_run())


def test_build_run_plan_routes_web_on_temporal_gap_without_intent_llm(monkeypatch) -> None:
    async def _run() -> None:
        from oaao_orchestrator.planner import build_run_plan
        from oaao_orchestrator import turn_intent as turn_intent_mod

        async def fake_score(*_args, **_kwargs):
            return None

        monkeypatch.setattr(turn_intent_mod, "score_turn_intent", fake_score)

        req = SimpleNamespace(
            vault_auto_rag=False,
            enable_web_search=False,
            chat_attachments=[],
            messages=[{"role": "user", "content": "我想知道2026年5月發生的大事"}],
            allowed_agents=["slide_designer"],
            planner_intent=None,
            planner=None,
            run_planner_mode="stub",
            slide_designer=None,
            endpoint=SimpleNamespace(
                base_url="http://chat/v1",
                model="chat-model",
                knowledge_cutoff="2025-01-01",
                config={},
                api_key_env="OPENAI_API_KEY",
            ),
        )
        plan = await build_run_plan(req, chat_completions_url="http://x/v1", api_key=None, model="x")
        assert any(t.agent_kind == "web_search" for t in plan.tasks)
        assert req.turn_intent["needs_web_search"] is True
        assert req.turn_intent["temporal_knowledge_gap"] is True

    asyncio.run(_run())


def test_build_run_plan_routes_web_when_intent_llm_scores_high(monkeypatch) -> None:
    async def _run() -> None:
        from oaao_orchestrator.agent_intent_hook import AgentIntentSignals
        from oaao_orchestrator.planner import build_run_plan
        from oaao_orchestrator import turn_intent as turn_intent_mod

        async def fake_score(*_args, **_kwargs):
            return AgentIntentSignals(
                needs_web_search=True,
                analysis={"web_search": 1.0},
                reasoning={"web_search": "temporal gap"},
            )

        monkeypatch.setattr(turn_intent_mod, "score_turn_intent", fake_score)

        req = SimpleNamespace(
            vault_auto_rag=False,
            enable_web_search=False,
            chat_attachments=[],
            messages=[{"role": "user", "content": "我想知道2026年5月發生的大事"}],
            allowed_agents=["slide_designer"],
            planner_intent={"base_url": "http://x", "model": "m"},
            planner=None,
            run_planner_mode="stub",
            slide_designer=None,
            endpoint=SimpleNamespace(knowledge_cutoff="2026-05-28", config={}),
        )
        plan = await build_run_plan(req, chat_completions_url="http://x/v1", api_key=None, model="x")
        assert any(t.agent_kind == "web_search" for t in plan.tasks)

    asyncio.run(_run())
