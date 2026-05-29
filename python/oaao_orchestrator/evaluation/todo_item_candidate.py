"""Post-turn todo candidate heuristic (CS-6-S3)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

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


def classify_todo_item_candidate(
    *,
    conversation_id: int,
    messages: list[dict[str, Any]],
    assistant_text: str,
    min_confidence: float = 0.58,
) -> TodoItemCandidate | None:
    """Lightweight post-stream classifier — no extra LLM in v1."""
    combined = (assistant_text or "").strip()
    for msg in reversed(messages[-6:]):
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            combined = f"{content.strip()}\n{combined}"
        if role == "user" and isinstance(content, str) and len(content.strip()) > 40:
            break

    if len(combined) < 24:
        return None

    lower = combined.lower()
    marker_hits = sum(1 for m in _TODO_MARKERS if m in lower)
    tasks = _extract_task_lines(combined)
    if not tasks and marker_hits < 1:
        return None

    title = tasks[0] if tasks else combined.split("\n", 1)[0][:120].strip()
    if len(title) < 6:
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
