"""AUDIT-5 — consolidated conversation intent signals."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.planner import needs_multi_agent_turn
from oaao_orchestrator.planner_llm import (
    _plan_signals_handbook_vol_teaching,
    inject_slide_designer_for_teaching_intent,
)
from oaao_orchestrator.slide_project.conversation_intent import (
    signals_explicit_vault_document_reference,
    signals_handbook_vol_slide_intent,
    text_signals_vault_grounding,
    wants_slide_designer_inject,
)
from oaao_orchestrator.tasks.models import RunTaskSpec, RunTaskType


def test_handbook_vol_query_signals_grounding() -> None:
    q = "Regulatory Handbook 中的 Vol.3 是在說什麼?"
    assert signals_explicit_vault_document_reference(q)
    assert text_signals_vault_grounding(q)


def test_teaching_without_vol_not_slide_intent() -> None:
    assert not signals_handbook_vol_slide_intent("用 handbook 做教學")
    req = SimpleNamespace(
        enable_web_search=False,
        chat_attachments=[],
        slide_designer=None,
        messages=[{"role": "user", "content": "用 handbook 做教學"}],
    )
    assert needs_multi_agent_turn(req) is False


def test_slide_handbook_vol_triggers_multi_agent() -> None:
    msg = "用 Regulatory Handbook Vol.3 做教學簡報"
    assert signals_handbook_vol_slide_intent(msg)
    req = SimpleNamespace(
        enable_web_search=False,
        chat_attachments=[],
        slide_designer=None,
        messages=[{"role": "user", "content": msg}],
    )
    assert needs_multi_agent_turn(req) is True


def test_inject_requires_template_or_plan_or_slide_vol() -> None:
    assert not wants_slide_designer_inject(
        "Explain compliance",
        slide_designer_cfg=None,
        plan_handbook_vol=False,
    )
    assert wants_slide_designer_inject(
        "Handbook vol 3",
        slide_designer_cfg={"template_id": "tpl"},
        plan_handbook_vol=False,
    )


def test_plan_handbook_vol_injects_slide_designer() -> None:
    specs = inject_slide_designer_for_teaching_intent(
        [
            RunTaskSpec(
                id="rt-1",
                title="Review Regulatory Handbook Vol 3",
                type=RunTaskType.VAULT_RAG,
            ),
            RunTaskSpec(id="rt-2", title="Reply", type=RunTaskType.LLM_STREAM),
        ],
        allowed_agents=["slide_designer", "vault_rag"],
        messages=[{"role": "user", "content": "Explain compliance"}],
        slide_designer_cfg=None,
    )
    assert any(s.agent_kind == "slide_designer" for s in specs)
    assert _plan_signals_handbook_vol_teaching(
        [
            RunTaskSpec(
                id="x",
                title="Regulatory Handbook Vol 3 summary",
                type=RunTaskType.LLM_STREAM,
            )
        ]
    )
