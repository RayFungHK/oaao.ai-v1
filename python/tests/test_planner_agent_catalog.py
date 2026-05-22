"""Planner agent catalog — PHP payload merge + LLM guide text."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.planner_catalog import (
    catalog_from_request,
    planner_agent_guide,
)
from oaao_orchestrator.planner_llm import _planner_system_prompt


def test_catalog_from_request_overrides_builtin() -> None:
    req = SimpleNamespace(
        agent_catalog=[
            {
                "agent_kind": "slide_designer",
                "name": "Slide designer",
                "description": "Deck builder",
                "planner_hint": "Use for presentations and multi-slide decks.",
            }
        ]
    )
    cat = catalog_from_request(req)
    assert cat["slide_designer"].name == "Slide designer"
    assert "presentations" in cat["slide_designer"].description


def test_planner_agent_guide_lists_allowed_only() -> None:
    req = SimpleNamespace(
        agent_catalog=[
            {
                "agent_kind": "sandbox_code",
                "name": "Sandbox",
                "planner_hint": "Run isolated code.",
            }
        ]
    )
    cat = catalog_from_request(req)
    guide = planner_agent_guide(["sandbox_code", "slide_designer"], catalog=cat)
    assert "sandbox_code" in guide
    assert "Run isolated code" in guide
    assert "slide_designer" not in guide


def test_planner_system_prompt_includes_agent_guide() -> None:
    prompt = _planner_system_prompt(
        allowed_agents=["sandbox_code"],
        max_tasks=8,
        agent_guide="- sandbox_code (Sandbox): Run code.",
    )
    assert "Allowed agents" in prompt
    assert "sandbox_code" in prompt
    assert "Run code" in prompt
