"""Registry-driven agent intent hook + planning prompt modules."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.agent_intent_hook import (
    build_intent_agent_registry_list,
    build_intent_analysis_schema,
    intent_hook_agent_kinds,
    parse_agent_intent_response,
    render_turn_agent_intent_prompt,
)
from oaao_orchestrator.planning_prompt import (
    load_planner_system_body,
    render_planner_system_prompt,
    render_report_system_prompt,
)


def test_intent_hook_agents_from_request() -> None:
    req = SimpleNamespace(allowed_agents=["web_search", "slide_designer", "office_generate"])
    kinds = intent_hook_agent_kinds(req)
    assert kinds == ["web_search", "slide_designer", "office_generate"]


def test_build_intent_analysis_schema_dynamic() -> None:
    schema = build_intent_analysis_schema(["web_search", "sandbox_code"])
    assert '"web_search": 0.0' in schema
    assert '"sandbox_code": 0.0' in schema
    assert '"slide_designer"' not in schema


def test_render_turn_agent_intent_includes_registry() -> None:
    req = SimpleNamespace(
        allowed_agents=["web_search"],
        agent_catalog=[
            {
                "agent_kind": "web_search",
                "name": "Web search",
                "planner_hint": "Live public web facts.",
            }
        ],
    )
    msg = render_turn_agent_intent_prompt(
        user_input="2026 年 5 月大事",
        agent_kinds=["web_search"],
        extra_vars={
            "llm_knowledge_cutoff": "2025-01-01",
            "current_date": "2026-05-28",
        },
        req=req,
    )
    assert "1. web_search:" in msg
    assert "Live public web facts" in msg or "LLM Knowledge date is not fulfilled" in msg
    assert "2026 年 5 月" in msg
    assert "2025-01-01" in msg
    assert "---\nUser Input\n---" in msg.replace("\r\n", "\n") or "User Input" in msg
    assert '"2026 年 5 月大事"' not in msg


def test_build_intent_agent_registry_list_numbered() -> None:
    text = build_intent_agent_registry_list(
        ["web_search", "slide_designer", "office_generate"],
    )
    assert text.startswith("1. web_search:")
    assert "2. slide_designer:" in text
    assert "3. office_generate:" in text
    assert "LLM Knowledge date is not fulfilled" in text


def test_render_turn_agent_intent_preserves_user_newlines() -> None:
    msg = render_turn_agent_intent_prompt(
        user_input="line one\nline two",
        agent_kinds=["web_search"],
        extra_vars={"llm_knowledge_cutoff": "2025-01-01", "current_date": "2026-05-28"},
    )
    assert "line one\nline two" in msg


def test_parse_agent_intent_response_filters_unknown_keys() -> None:
    text = '{"analysis": {"web_search": 0.91, "unknown_agent": 0.5}, "reasoning": {"web_search": "news"}}'
    sig = parse_agent_intent_response(text, agent_kinds=["web_search"])
    assert sig is not None
    assert sig.needs_web_search is True
    assert sig.analysis.get("web_search") == 0.91
    assert "unknown_agent" not in sig.analysis


def test_planner_system_from_markdown_only() -> None:
    body = load_planner_system_body()
    assert "needs_web_search" in body
    assert "{{allowed_agents}}" in body or "allowed_agents" in body


def test_render_planner_system_prompt_substitutes() -> None:
    out = render_planner_system_prompt(
        allowed_agents=["web_search"],
        max_tasks=6,
        agent_guide="- web_search: public web",
    )
    assert "At most 6 tasks" in out
    assert "web_search" in out


def test_render_report_system_prompt() -> None:
    out = render_report_system_prompt(agent_guide="- web_search: search")
    assert "append" in out
    assert "web_search" in out
