"""CS-5 — calendar event planner (heuristic path)."""

import asyncio

from oaao_orchestrator.evaluation.calendar_event_planner import (
    run_calendar_event_planner,
    summarize_calendar_notes,
)


def test_summarize_calendar_notes_strips_markdown_and_dedupes() -> None:
    raw = "### Title\n\n**Hello** hello\n\n---\n\nLong paragraph one.\n\nLong paragraph one."
    out = summarize_calendar_notes(raw, 200)
    assert "###" not in out
    assert "**" not in out
    assert out.count("Long paragraph one.") == 1


def test_run_calendar_event_planner_heuristic_without_llm() -> None:
    payload = {
        "title": "A" * 120,
        "notes": "### Diary\n\n" + ("travel tips " * 80),
        "start_at": "2026-12-25T10:30:00Z",
        "end_at": "2026-12-25T11:30:00Z",
        "location": "Tokyo",
    }
    out = asyncio.run(run_calendar_event_planner(payload))
    assert out.get("ok") is True
    assert len(str(out.get("title") or "")) <= 80
    assert len(str(out.get("notes") or "")) <= 481
    assert out.get("source") == "heuristic"
