"""Post-turn calendar event candidate heuristic (CS-5-S4)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

_ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_CJK_DATE = re.compile(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")
_TIME_24 = re.compile(r"\b(\d{1,2}):(\d{2})\b")
_TIME_AMPM = re.compile(
    r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b",
    re.IGNORECASE,
)
_LOCATION = re.compile(
    r"(?:location|venue|\bat\b|@|地點|地点|場地|场地)[：:\s]+([^\n,.;]{3,80})",
    re.IGNORECASE,
)
_META_ASSISTANT_MARKERS = (
    "knowledge-base",
    "vault search",
    "scoped or ran",
    "tool run",
    "rag ",
    "event-stream",
    "pipeline task",
    "checklist item",
    "micro-skill",
)
_SCHEDULE_MARKERS = (
    "meeting",
    "schedule",
    "calendar",
    "appointment",
    "deadline",
    "remind",
    "會議",
    "会议",
    "預約",
    "预约",
    "排程",
    "日程",
    "deadline",
    "tomorrow",
    "next week",
    "明天",
    "下週",
    "下周",
)


@dataclass
class CalendarEventCandidate:
    title: str
    start_at: str
    end_at: str
    all_day: bool
    timezone: str
    location: str
    notes: str
    confidence: float
    conversation_id: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "start_at": self.start_at,
            "end_at": self.end_at,
            "all_day": self.all_day,
            "timezone": self.timezone,
            "location": self.location,
            "notes": self.notes[:800],
            "confidence": round(float(self.confidence), 3),
            "conversation_id": self.conversation_id,
        }


def _is_tool_meta_turn(assistant_text: str) -> bool:
    lower = assistant_text.strip().lower()
    if len(lower) < 8:
        return True
    return any(m in lower for m in _META_ASSISTANT_MARKERS)


def _last_user_text(messages: list[dict[str, Any]]) -> str:
    for msg in reversed(messages[-8:]):
        if not isinstance(msg, dict) or msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
    return ""


def _schedule_context(messages: list[dict[str, Any]], assistant_text: str) -> str:
    """Date/time signals from latest user + current assistant only (not full thread history)."""
    user_tail = _last_user_text(messages)
    assistant = assistant_text.strip()
    if user_tail and assistant:
        return f"{user_tail}\n{assistant}"
    return assistant or user_tail


def _parse_date(text: str) -> datetime | None:
    m = _ISO_DATE.search(text)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=UTC)
        except ValueError:
            pass
    m = _CJK_DATE.search(text)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=UTC)
        except ValueError:
            pass
    return None


def _parse_time(text: str) -> tuple[int, int] | None:
    m = _TIME_24.search(text)
    if m:
        h, mn = int(m.group(1)), int(m.group(2))
        if 0 <= h <= 23 and 0 <= mn <= 59:
            return h, mn
    m = _TIME_AMPM.search(text)
    if m:
        h = int(m.group(1)) % 12
        mn = int(m.group(2) or 0)
        if m.group(3).lower().startswith("p"):
            h += 12
        if 0 <= h <= 23 and 0 <= mn <= 59:
            return h, mn
    return None


def _title_from_text(text: str) -> str:
    for line in text.splitlines():
        ln = line.strip()
        if len(ln) >= 6 and not _ISO_DATE.search(ln) and not _CJK_DATE.search(ln):
            return ln[:120]
    return "Scheduled event"


def classify_calendar_event_candidate(
    *,
    conversation_id: int,
    messages: list[dict[str, Any]],
    assistant_text: str,
    min_confidence: float = 0.62,
) -> CalendarEventCandidate | None:
    """Lightweight post-stream classifier — no extra LLM call in v1."""
    assistant = (assistant_text or "").strip()
    if len(assistant) < 12 or _is_tool_meta_turn(assistant):
        return None

    blob = _schedule_context(messages, assistant)
    lower = blob.lower()
    lower_a = assistant.lower()
    marker_hits = sum(1 for m in _SCHEDULE_MARKERS if m in lower)
    marker_in_turn = sum(1 for m in _SCHEDULE_MARKERS if m in lower_a)
    if marker_hits < 1 or marker_in_turn < 1:
        return None

    day = _parse_date(blob)
    if day is None:
        if "tomorrow" in lower or "明天" in blob:
            day = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        else:
            return None

    tm = _parse_time(blob)
    all_day = tm is None
    if tm:
        start = day.replace(hour=tm[0], minute=tm[1], second=0, microsecond=0)
        end = start + timedelta(hours=1)
    else:
        start = day.replace(hour=9, minute=0, second=0, microsecond=0)
        end = start + timedelta(hours=1)

    loc_m = _LOCATION.search(blob)
    location = loc_m.group(1).strip() if loc_m else ""

    confidence = 0.48 + min(0.35, marker_hits * 0.08)
    if tm is not None:
        confidence += 0.12
    if location:
        confidence += 0.08
    if confidence < min_confidence:
        return None

    title = _title_from_text(assistant)
    notes = assistant[:400]

    return CalendarEventCandidate(
        title=title,
        start_at=start.isoformat().replace("+00:00", "Z"),
        end_at=end.isoformat().replace("+00:00", "Z"),
        all_day=all_day,
        timezone="UTC",
        location=location,
        notes=notes,
        confidence=min(0.94, confidence),
        conversation_id=conversation_id,
    )
