"""Post-turn todo candidate heuristic (CS-6-S3)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_META_ASSISTANT_MARKERS = (
    "knowledge-base",
    "vault search",
    "scoped or ran",
    "tool run",
    "rag ",
    "event-stream",
    "pipeline task",
)

_TODO_MARKERS = (
    "todo",
    "to-do",
    "action item",
    "follow up",
    "follow-up",
    "remind me",
    "don't forget",
    "need to",
    "should ",
    "must ",
    "待辦",
    "記得",
    "提醒",
    "跟進",
    "跟进",
    "完成",
    "提交",
    "send ",
    "email ",
    "call ",
    "review ",
)
_CHECKBOX = re.compile(r"^\s*[-*]\s*\[[ xX]\]\s+(.+)$", re.MULTILINE)
_BULLET_TASK = re.compile(
    r"^\s*(?:[-*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.{8,200})$",
    re.MULTILINE,
)


@dataclass
class TodoItemCandidate:
    title: str
    context_snippet: str
    confidence: float
    conversation_id: int
    priority: str = "normal"
    due_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "context_snippet": self.context_snippet,
            "confidence": round(float(self.confidence), 3),
            "conversation_id": self.conversation_id,
            "priority": self.priority,
            "due_at": self.due_at,
        }


def _extract_task_lines(text: str) -> list[str]:
    lines: list[str] = []
    for m in _CHECKBOX.finditer(text):
        t = m.group(1).strip()
        if t:
            lines.append(t)
    if lines:
        return lines[:3]
    for m in _BULLET_TASK.finditer(text):
        t = m.group(1).strip()
        lower = t.lower()
        if any(k in lower for k in ("todo", "task", "need", "must", "should", "follow", "send", "review", "待辦", "記得")):
            lines.append(t)
    return lines[:3]


def _todo_title_duplicates_open(title: str, open_todo_items: list[dict[str, Any]] | None) -> bool:
    """CS-6-S3 — skip suggestion when a similar open todo already exists in this thread."""
    needle = title.strip().lower()
    if len(needle) < 4 or not open_todo_items:
        return False
    for row in open_todo_items:
        if not isinstance(row, dict):
            continue
        existing = str(row.get("title") or "").strip().lower()
        if len(existing) < 4:
            continue
        if needle == existing or needle in existing or existing in needle:
            return True
    return False


def _last_user_text(messages: list[dict[str, Any]]) -> str:
    for msg in reversed(messages[-6:]):
        if not isinstance(msg, dict) or msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
    return ""


def _is_tool_meta_turn(assistant_text: str) -> bool:
    lower = assistant_text.strip().lower()
    if len(lower) < 8:
        return True
    return any(m in lower for m in _META_ASSISTANT_MARKERS)


def classify_todo_item_candidate(
    *,
    conversation_id: int,
    messages: list[dict[str, Any]],
    assistant_text: str,
    min_confidence: float = 0.58,
    open_todo_items: list[dict[str, Any]] | None = None,
) -> TodoItemCandidate | None:
    """Lightweight post-stream classifier — no extra LLM in v1."""
    assistant = (assistant_text or "").strip()
    if _is_tool_meta_turn(assistant):
        return None

    user_tail = _last_user_text(messages)
    combined = f"{user_tail}\n{assistant}".strip() if user_tail else assistant

    if len(combined) < 24:
        return None

    lower = combined.lower()
    marker_hits = sum(1 for m in _TODO_MARKERS if m in lower)
    tasks = _extract_task_lines(combined)
    if not tasks and marker_hits < 1:
        return None

    if tasks:
        title = tasks[0]
    else:
        title = ""
        for line in combined.splitlines():
            ln = line.strip()
            if len(ln) >= 6:
                title = ln[:120]
                break
    if len(title) < 6:
        return None

    if _todo_title_duplicates_open(title, open_todo_items):
        return None

    confidence = 0.5 + min(0.25, marker_hits * 0.06) + (0.12 if tasks else 0.0)
    if confidence < min_confidence:
        return None

    snippet = combined[:400].strip()
    return TodoItemCandidate(
        title=title,
        context_snippet=snippet,
        confidence=confidence,
        conversation_id=conversation_id,
    )
