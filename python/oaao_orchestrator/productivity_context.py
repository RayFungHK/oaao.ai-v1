"""Inject calendar/todo world state into main-chat and post-turn classifier prompts."""

from __future__ import annotations

from typing import Any


def format_upcoming_calendar_events(events: list[Any] | None) -> str:
    if not events:
        return "(none)"
    lines: list[str] = []
    for row in events[:32]:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        start = str(row.get("start_at") or "").strip()
        end = str(row.get("end_at") or "").strip()
        loc = str(row.get("location") or "").strip()
        if not title and not start:
            continue
        bit = title or "Event"
        if start:
            bit += f" · {start}"
            if end and end != start:
                bit += f" – {end}"
        if loc:
            bit += f" @ {loc}"
        lines.append(f"- {bit}")
    return "\n".join(lines) if lines else "(none)"


def format_open_todo_items(items: list[Any] | None) -> str:
    if not items:
        return "(none)"
    lines: list[str] = []
    for row in items[:40]:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if title:
            lines.append(f"- {title}")
    return "\n".join(lines) if lines else "(none)"


def productivity_template_variables(chat_request: object | None) -> dict[str, str]:
    events = getattr(chat_request, "upcoming_calendar_events", None) if chat_request else None
    todos = getattr(chat_request, "open_todo_items", None) if chat_request else None
    ev_list = events if isinstance(events, list) else []
    todo_list = todos if isinstance(todos, list) else []
    return {
        "upcoming_calendar_events": format_upcoming_calendar_events(ev_list),
        "open_todo_items": format_open_todo_items(todo_list),
    }


def build_productivity_system_block(chat_request: object | None) -> str | None:
    vars_ = productivity_template_variables(chat_request)
    if vars_["upcoming_calendar_events"] == "(none)" and vars_["open_todo_items"] == "(none)":
        return None
    parts: list[str] = ["--- Productivity context (calendar & todos) ---"]
    if vars_["upcoming_calendar_events"] != "(none)":
        parts.append(
            "Upcoming calendar (avoid conflicts; do not schedule in the past):\n"
            + vars_["upcoming_calendar_events"]
        )
    if vars_["open_todo_items"] != "(none)":
        parts.append(
            "Open todos for this conversation (avoid duplicate titles):\n" + vars_["open_todo_items"]
        )
    parts.append(
        "Use this when answering scheduling or checklist requests. "
        "When the user may confirm a calendar block or todos, put human prose first, then machine blocks last. "
        "Preferred fences (one each max), after human prose:\n"
        "- ```oaao-calendar\\n{\"title\",\"start_at\",\"end_at\",\"confidence\",\"fence_memo\",\"fence_items\",...}\\n```\n"
        "- ```oaao-todo\\n{\"type\":\"todo_items_suggested\",\"fence_memo\",\"fence_items\","
        "\"items\":[{\"title\",\"confidence\"},...]}\\n```\n"
        "`fence_memo` is a short summary; `fence_items` is an optional string[] (or {text}[]) "
        "rendered as a bullet list in the fence preview (human-readable lines, not machine todos). "
        "Use `items` only for confirmable todo payloads with title + confidence. "
        "Use field name title on todo items; ISO-8601 UTC (Z) times. "
        "Omit blocks when there is nothing to confirm."
    )
    return "\n\n".join(parts)


def apply_productivity_context(*, req: Any, messages_for_llm: list[Any]) -> None:
    block = build_productivity_system_block(req)
    if not block:
        return
    from oaao_orchestrator.vault_rag.messages import inject_system_message

    inject_system_message(messages_for_llm, block)
