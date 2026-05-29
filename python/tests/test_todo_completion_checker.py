"""CS-6-S7 — todo completion checker."""

from oaao_orchestrator.evaluation.todo_completion_checker import classify_todo_resolve_hint


def test_resolve_hint_matches_title_in_done_reply():
    hint = classify_todo_resolve_hint(
        conversation_id=9,
        assistant_text="Done — I sent the quarterly report to finance as requested.",
        open_todos=[{"todo_id": 42, "title": "Send quarterly report to finance"}],
    )
    assert hint is not None
    assert hint.todo_id == 42
    assert hint.confidence >= 0.55


def test_resolve_hint_rejects_without_done_marker():
    hint = classify_todo_resolve_hint(
        conversation_id=1,
        assistant_text="I will send the quarterly report tomorrow.",
        open_todos=[{"todo_id": 1, "title": "Send quarterly report"}],
    )
    assert hint is None
