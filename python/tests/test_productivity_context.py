"""Productivity compose fence injection — PHP module_prompts content only."""

from oaao_orchestrator.productivity_context import (
    compose_assistant_blocks,
    format_upcoming_calendar_events,
    inject_compose_response_fences,
)


def test_format_upcoming_calendar_events() -> None:
    text = format_upcoming_calendar_events(
        [{"title": "Focus", "start_at": "2026-05-31T09:00:00Z", "end_at": "2026-05-31T10:00:00Z"}]
    )
    assert "Focus" in text
    assert "2026-05-31" in text


def test_compose_blocks_from_module_prompts() -> None:
    req = type(
        "R",
        (),
        {
            "module_prompts": {
                "compose_assistant": {
                    "calendar": {"content": "Calendar Schedule\n```oaao-calendar\n{}\n```"},
                    "todo": {"content": "Todo\n```oaao-todo\n{}\n```"},
                },
            },
        },
    )()
    blocks = compose_assistant_blocks(req)
    assert len(blocks) == 2
    assert "oaao-calendar" in blocks[0]
    assert "oaao-todo" in blocks[1]


def test_inject_skipped_when_compose_assistant_empty() -> None:
    req = type("R", (), {"module_prompts": {}})()
    messages: list[dict[str, str]] = [{"role": "user", "content": "schedule tomorrow"}]
    inject_compose_response_fences(req=req, messages_for_llm=messages)
    assert len(messages) == 1


def test_inject_compose_response_fences_prepends_system() -> None:
    req = type(
        "R",
        (),
        {
            "module_prompts": {
                "compose_assistant": {
                    "calendar": {
                        "content": "Calendar Schedule\n```oaao-calendar\n{\"title\":\"Meet\"}\n```",
                    },
                },
            },
        },
    )()
    messages: list[dict[str, str]] = [
        {"role": "system", "content": "--- Web search results ---\n[W1] hit"},
        {"role": "user", "content": "安排行程"},
    ]
    inject_compose_response_fences(req=req, messages_for_llm=messages)
    assert "oaao-calendar" in messages[0]["content"]
    assert "Web search results" in messages[0]["content"]
    assert "fluent" in messages[0]["content"].lower()
