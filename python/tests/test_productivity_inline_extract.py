from oaao_orchestrator.productivity_inline_extract import (
    extract_productivity_inline_blocks,
    inline_satisfied_action_ids,
    strip_productivity_inline_fences,
)


def test_extract_calendar_fence() -> None:
    text = (
        "Here is your plan.\n\n"
        "```oaao-calendar\n"
        '{"title":"Sync","start_at":"2026-06-01T10:00:00Z","end_at":"2026-06-01T11:00:00Z",'
        '"confidence":0.9}\n'
        "```\n"
    )
    stripped, meta = extract_productivity_inline_blocks(text, conversation_id=153)
    assert "oaao-calendar" not in stripped
    assert meta.get("productivity_inline_extracted") is True
    cal = meta.get("calendar_event_suggested")
    assert isinstance(cal, dict)
    assert cal.get("title") == "Sync"
    assert "calendar_event_suggested" in inline_satisfied_action_ids(meta)


def test_extract_todo_items_fence() -> None:
    text = (
        "Tasks:\n```oaao-todo\n"
        '{"type":"todo_items_suggested","items":['
        '{"title":"A","context_snippet":"x","confidence":0.8},'
        '{"title":"B","context_snippet":"y","confidence":0.85}'
        "]}\n```"
    )
    _, meta = extract_productivity_inline_blocks(text, conversation_id=1)
    items = meta.get("todo_items_suggested")
    assert isinstance(items, list)
    assert len(items) == 2


def test_strip_fences_only() -> None:
    raw = "Hi\n```oaao-todo\n{}\n```\nBye"
    assert "oaao-todo" not in strip_productivity_inline_fences(raw)


def test_fence_memo_and_fence_items() -> None:
    text = (
        "Plan.\n```oaao-todo\n"
        '{"type":"todo_items_suggested","fence_memo":"This week","fence_items":["Draft report","Review PR"],'
        '"items":[{"title":"Draft report","confidence":0.9},{"title":"Review PR","confidence":0.88}]}\n'
        "```"
    )
    _, meta = extract_productivity_inline_blocks(text, conversation_id=2)
    assert meta.get("todo_items_fence_memo") == "This week"
    assert meta.get("todo_items_fence_items") == ["Draft report", "Review PR"]
    assert len(meta.get("todo_items_suggested") or []) == 2

    cal_text = (
        "```oaao-calendar\n"
        '{"title":"Focus","start_at":"2026-06-01T09:00:00Z","end_at":"2026-06-01T10:00:00Z",'
        '"confidence":0.9,"fence_memo":"Morning block","fence_items":["No meetings","Deep work"]}\n'
        "```"
    )
    _, cal_meta = extract_productivity_inline_blocks(cal_text, conversation_id=3)
    cal = cal_meta.get("calendar_event_suggested")
    assert isinstance(cal, dict)
    assert cal.get("fence_memo") == "Morning block"
    assert cal.get("fence_items") == ["No meetings", "Deep work"]


def test_ignores_labeled_generic_json_without_oaao_fence() -> None:
    """Locale headings + ```json are not parsed; post-turn / prompt enforce oaao-* fences."""
    text = (
        "Plan.\n\nCalendar:\n```json\n"
        '{"title":"X","start_at":"2026-05-31T09:30:00Z","end_at":"2026-05-31T10:30:00Z","confidence":0.9}\n'
        "```\n"
    )
    stripped, meta = extract_productivity_inline_blocks(text, conversation_id=1)
    assert meta.get("calendar_event_suggested") is None
    assert meta.get("productivity_inline_extracted") is not True
    assert "Calendar:" in stripped
