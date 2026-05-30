"""Productivity send context formatting."""

from oaao_orchestrator.productivity_context import (
    apply_productivity_context,
    build_productivity_system_block,
    format_upcoming_calendar_events,
)


def test_format_upcoming_calendar_events() -> None:
    text = format_upcoming_calendar_events(
        [{"title": "Focus", "start_at": "2026-05-31T09:00:00Z", "end_at": "2026-05-31T10:00:00Z"}]
    )
    assert "Focus" in text
    assert "2026-05-31" in text


def test_build_productivity_system_block_empty() -> None:
    assert build_productivity_system_block(type("R", (), {})()) is None


def test_apply_productivity_context_injects() -> None:
    req = type(
        "R",
        (),
        {
            "upcoming_calendar_events": [{"title": "Meet", "start_at": "2026-06-01T10:00:00Z"}],
            "open_todo_items": [],
        },
    )()
    messages: list[dict[str, str]] = [{"role": "user", "content": "hi"}]
    apply_productivity_context(req=req, messages_for_llm=messages)
    assert messages[0]["role"] == "system"
    assert "Meet" in messages[0]["content"]
