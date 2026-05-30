"""Extract productivity confirmation blocks from assistant reply text.

Only parses the machine contract fences (``oaao-calendar`` / ``oaao-todo``). Locale headings,
generic ``json`` blocks, and field aliases are not handled here — the main chat LLM is
instructed via ``module_prompts.compose_assistant`` at compose time.

Fence JSON is the action payload: extract → agent smoke test → inline Confirm/Dismiss.
Post-turn classifiers fill gaps when fences are absent or fail validation.
"""

from __future__ import annotations

import re
from typing import Any

from oaao_orchestrator.json_utils import extract_json_object

_CALENDAR_FENCE = re.compile(
    r"```oaao-calendar\s*\n([\s\S]*?)```",
    re.IGNORECASE,
)
_TODO_FENCE = re.compile(
    r"```oaao-todo\s*\n([\s\S]*?)```",
    re.IGNORECASE,
)
_STRIP_OAAO = re.compile(
    r"```oaao-(?:calendar|todo)\s*\n[\s\S]*?```\s*",
    re.IGNORECASE,
)

_CALENDAR_MIN_CONF = 0.62
_TODO_MIN_CONF = 0.58

_FENCE_ITEMS_MAX = 24
_FENCE_ITEM_MAX_LEN = 240


def _normalize_fence_items(raw: Any) -> list[str]:
    """Display-only bullet lines for fence preview (separate from structured ``items``)."""
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for row in raw:
        text = ""
        if isinstance(row, str):
            text = row.strip()
        elif isinstance(row, dict):
            for key in ("text", "title", "label", "memo"):
                val = row.get(key)
                if val is not None and str(val).strip():
                    text = str(val).strip()
                    break
        if not text:
            continue
        out.append(text[:_FENCE_ITEM_MAX_LEN])
        if len(out) >= _FENCE_ITEMS_MAX:
            break
    return out


def _clamp_conf(raw: Any, default: float) -> float:
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, v))


def _normalize_calendar_payload(obj: dict[str, Any], conversation_id: int) -> dict[str, Any] | None:
    title = str(obj.get("title") or "").strip()
    start_at = str(obj.get("start_at") or "").strip()
    if not title or not start_at:
        return None
    conf = _clamp_conf(obj.get("confidence"), 0.85)
    if conf < _CALENDAR_MIN_CONF:
        return None
    end_at = str(obj.get("end_at") or start_at).strip()
    out: dict[str, Any] = {
        "title": title[:200],
        "start_at": start_at,
        "end_at": end_at,
        "all_day": bool(obj.get("all_day")),
        "timezone": str(obj.get("timezone") or "UTC").strip() or "UTC",
        "location": str(obj.get("location") or "").strip()[:200],
        "notes": str(obj.get("notes") or "").strip()[:400],
        "confidence": round(conf, 3),
        "conversation_id": conversation_id,
    }
    memo = str(obj.get("fence_memo") or "").strip()
    if memo:
        out["fence_memo"] = memo[:1200]
    fence_items = _normalize_fence_items(obj.get("fence_items"))
    if fence_items:
        out["fence_items"] = fence_items
    return out


def _normalize_todo_item(obj: dict[str, Any], conversation_id: int) -> dict[str, Any] | None:
    title = str(obj.get("title") or "").strip()
    if not title:
        return None
    conf = _clamp_conf(obj.get("confidence"), 0.8)
    if conf < _TODO_MIN_CONF:
        return None
    return {
        "title": title[:120],
        "context_snippet": str(obj.get("context_snippet") or "").strip()[:200],
        "confidence": round(conf, 3),
        "conversation_id": conversation_id,
        "priority": str(obj.get("priority") or "normal").strip() or "normal",
        "due_at": obj.get("due_at"),
    }


def _parse_calendar_fence(body: str, conversation_id: int) -> dict[str, Any] | None:
    obj = extract_json_object(body)
    if not obj:
        return None
    action_type = str(obj.get("type") or "").strip().lower()
    if action_type == "calendar_event_suggested":
        return _normalize_calendar_payload(obj, conversation_id)
    if "actions" in obj and isinstance(obj["actions"], list):
        for row in obj["actions"]:
            if isinstance(row, dict) and str(row.get("type") or "") == "calendar_event_suggested":
                merged = {**row}
                merged.pop("type", None)
                hit = _normalize_calendar_payload(merged, conversation_id)
                if hit:
                    return hit
        return None
    return _normalize_calendar_payload(obj, conversation_id)


def _parse_todo_fence(body: str, conversation_id: int) -> dict[str, Any]:
    """Return meta fragment keys to merge (todo_item_suggested and/or todo_items_suggested)."""
    out: dict[str, Any] = {}
    obj = extract_json_object(body)
    if not obj:
        return out

    fence_memo = str(obj.get("fence_memo") or "").strip()
    if fence_memo:
        out["todo_items_fence_memo"] = fence_memo[:1200]
    fence_items = _normalize_fence_items(obj.get("fence_items"))
    if fence_items:
        out["todo_items_fence_items"] = fence_items

    action_type = str(obj.get("type") or "").strip().lower()
    if action_type == "todo_items_suggested":
        items_raw = obj.get("items")
        if isinstance(items_raw, list):
            items = []
            for row in items_raw:
                if isinstance(row, dict):
                    norm = _normalize_todo_item(row, conversation_id)
                    if norm:
                        items.append(norm)
            if len(items) >= 2:
                out["todo_items_suggested"] = items
            elif len(items) == 1:
                out["todo_item_suggested"] = items[0]
        return out

    if action_type == "todo_item_suggested":
        norm = _normalize_todo_item(obj, conversation_id)
        if norm:
            out["todo_item_suggested"] = norm
        return out

    if "actions" in obj and isinstance(obj["actions"], list):
        items = []
        for row in obj["actions"]:
            if not isinstance(row, dict):
                continue
            if str(row.get("type") or "") != "todo_item_suggested":
                continue
            merged = {**row}
            merged.pop("type", None)
            norm = _normalize_todo_item(merged, conversation_id)
            if norm:
                items.append(norm)
        if len(items) >= 2:
            out["todo_items_suggested"] = items
        elif len(items) == 1:
            out["todo_item_suggested"] = items[0]
        return out

    if "items" in obj and isinstance(obj["items"], list):
        items = []
        for row in obj["items"]:
            if isinstance(row, dict):
                norm = _normalize_todo_item(row, conversation_id)
                if norm:
                    items.append(norm)
        if len(items) >= 2:
            out["todo_items_suggested"] = items
        elif len(items) == 1:
            out["todo_item_suggested"] = items[0]
        return out

    norm = _normalize_todo_item(obj, conversation_id)
    if norm:
        out["todo_item_suggested"] = norm
    return out


def strip_productivity_inline_fences(text: str) -> str:
    """Remove ``oaao-calendar`` / ``oaao-todo`` blocks from visible assistant prose."""
    stripped = _STRIP_OAAO.sub("", text or "")
    return re.sub(r"\n{3,}", "\n\n", stripped).strip()


def extract_productivity_inline_blocks(
    text: str,
    *,
    conversation_id: int = 0,
) -> tuple[str, dict[str, Any]]:
    """
    Parse inline fences and return (stripped_text, meta_keys_for_persist).

    Sets ``productivity_inline_extracted`` when any fence was present (even if JSON empty).
    """
    raw = text or ""
    attached: dict[str, Any] = {}
    found_fence = False

    cal_match = _CALENDAR_FENCE.search(raw)
    if cal_match:
        found_fence = True
        cal = _parse_calendar_fence(cal_match.group(1), conversation_id)
        if cal:
            attached["calendar_event_suggested"] = cal

    todo_match = _TODO_FENCE.search(raw)
    if todo_match:
        found_fence = True
        attached.update(_parse_todo_fence(todo_match.group(1), conversation_id))

    if found_fence:
        attached["productivity_inline_extracted"] = True
        stripped = strip_productivity_inline_fences(raw)
    else:
        stripped = raw

    return stripped, attached


def inline_satisfied_action_ids(attached: dict[str, Any]) -> set[str]:
    """Post-turn action_ids that need no second LLM pass."""
    ids: set[str] = set()
    if attached.get("calendar_event_suggested"):
        ids.add("calendar_event_suggested")
    if attached.get("todo_item_suggested"):
        ids.add("todo_item_suggested")
        ids.add("todo_items_suggested")
    if attached.get("todo_items_suggested"):
        ids.add("todo_items_suggested")
        ids.add("todo_item_suggested")
    return ids
