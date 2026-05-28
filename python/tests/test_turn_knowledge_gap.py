from datetime import date
from types import SimpleNamespace

from oaao_orchestrator.turn_knowledge_gap import (
    knowledge_gap_context,
    resolve_llm_knowledge_cutoff,
    temporal_knowledge_gap,
)
from oaao_orchestrator.turn_intent import render_turn_intent_prompt


def test_resolve_llm_knowledge_cutoff_from_endpoint() -> None:
    req = SimpleNamespace(
        endpoint=SimpleNamespace(knowledge_cutoff="2024-06-01", config={}),
    )
    assert resolve_llm_knowledge_cutoff(req) == date(2024, 6, 1)


def test_resolve_llm_knowledge_cutoff_env_default() -> None:
    assert resolve_llm_knowledge_cutoff(None) == date(2025, 1, 1)


def test_temporal_knowledge_gap_chinese_month() -> None:
    cutoff = date(2025, 1, 1)
    assert temporal_knowledge_gap("我想知道2026年5月發生的大事", cutoff) is True


def test_temporal_knowledge_gap_before_cutoff() -> None:
    cutoff = date(2025, 1, 1)
    assert temporal_knowledge_gap("2024年發生的大事", cutoff) is False


def test_temporal_knowledge_gap_same_year_later_month() -> None:
    cutoff = date(2025, 1, 1)
    assert temporal_knowledge_gap("2025年6月新聞", cutoff) is True


def test_knowledge_gap_context_flags_gap() -> None:
    ctx = knowledge_gap_context(
        SimpleNamespace(endpoint=SimpleNamespace(knowledge_cutoff="2025-01-01", config={})),
        user_message="我想知道2026年5月發生的大事",
    )
    assert ctx["llm_knowledge_cutoff"] == "2025-01-01"
    assert ctx["knowledge_gap_detected"] == "yes"


def test_render_turn_intent_includes_cutoff_and_registry() -> None:
    msg = render_turn_intent_prompt(
        user_input="2026 年 5 月大事",
        extra_vars={
            "llm_knowledge_cutoff": "2025-01-01",
            "current_date": "2026-05-28",
            "knowledge_gap_detected": "yes",
        },
        agent_kinds=["web_search"],
    )
    assert "2025-01-01" in msg
    assert "2026-05-28" in msg
    assert "2026 年 5 月" in msg
    assert "1. web_search:" in msg
    assert "Temporal knowledge gap detected: yes" in msg
