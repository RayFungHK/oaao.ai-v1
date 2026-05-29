"""CS-6-S7 — detect assistant completion language vs open thread todos."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_DONE_MARKERS = (
    "done",
    "completed",
    "finished",
    "resolved",
    "marked complete",
    "checked off",
    "已完成",
    "完成了",
    "搞定",
    "辦妥",
    "弄好了",
)


@dataclass
class TodoResolveHint:
    todo_id: int
    title: str
    confidence: float
    conversation_id: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "todo_id": self.todo_id,
            "title": self.title,
            "confidence": round(float(self.confidence), 3),
            "conversation_id": self.conversation_id,
        }


def _normalize_title(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def classify_todo_resolve_hint(
    *,
    conversation_id: int,
    assistant_text: str,
    open_todos: list[dict[str, Any]],
    min_confidence: float = 0.55,
) -> TodoResolveHint | None:
    """Match completion phrasing in assistant reply to an open todo title."""
    text = (assistant_text or "").strip()
    if len(text) < 12 or not open_todos:
        return None

    lower = text.lower()
    if not any(m in lower for m in _DONE_MARKERS):
        return None

    best: TodoResolveHint | None = None
    best_score = 0.0

    for row in open_todos:
        if not isinstance(row, dict):
            continue
        todo_id = int(row.get("todo_id") or 0)
        title = str(row.get("title") or "").strip()
        if todo_id < 1 or len(title) < 4:
            continue
        norm = _normalize_title(title)
        if not norm:
            continue
        if norm in lower or norm[: min(24, len(norm))] in lower:
            score = 0.72 + min(0.2, len(norm) / 80.0)
        else:
            tokens = [t for t in re.split(r"[^\w\u4e00-\u9fff]+", norm) if len(t) >= 3]
            hits = sum(1 for t in tokens if t in lower)
            if hits < max(1, len(tokens) // 2):
                continue
            score = 0.55 + hits * 0.08
        if score > best_score:
            best_score = score
            best = TodoResolveHint(
                todo_id=todo_id,
                title=title,
                confidence=score,
                conversation_id=conversation_id,
            )

    if best is None or best.confidence < min_confidence:
        return None
    return best
