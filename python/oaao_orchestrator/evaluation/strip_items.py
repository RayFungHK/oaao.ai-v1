"""Build canonical ``ui_stage`` strip ``items[]`` with signed ``strip_hash``."""

from __future__ import annotations

from typing import Any

from oaao_orchestrator.strip_hash import issue_strip_hash

_STRIP_ACTIONS: dict[str, dict[str, str | bool]] = {
    "calendar_event_suggested": {
        "agent": "calendar_schedule",
        "confirmation": True,
        "confirm_label": "Add to calendar",
    },
    "todo_item_suggested": {
        "agent": "todo_extract",
        "confirmation": True,
        "confirm_label": "Add to todos",
    },
    "todo_items_suggested": {
        "agent": "todo_extract",
        "confirmation": True,
        "confirm_label": "Add to todos",
    },
    "todo_resolve_suggested": {
        "agent": "todo_extract",
        "confirmation": False,
        "confirm_label": "Resolve",
    },
}


def _description_for(action_id: str, payload: Any) -> str:
    if action_id == "calendar_event_suggested" and isinstance(payload, dict):
        title = str(payload.get("title") or "").strip()
        return f"Add to calendar? · {title}" if title else "Add to calendar?"
    if action_id == "todo_item_suggested" and isinstance(payload, dict):
        title = str(payload.get("title") or "").strip()
        return f"Add to todos? · {title}" if title else "Add to todos?"
    if action_id == "todo_items_suggested" and isinstance(payload, list):
        n = len(payload)
        return f"Add {n} todos?" if n >= 2 else "Add to todos?"
    if action_id == "todo_resolve_suggested" and isinstance(payload, dict):
        title = str(payload.get("title") or "Todo").strip()
        return f"Mark done: {title}"
    return "Suggested action"


def _preview_for(action_id: str, payload: Any) -> dict[str, str | bool]:
    cfg = _STRIP_ACTIONS.get(action_id) or {}
    confirmation = bool(cfg.get("confirmation", True))
    if action_id == "calendar_event_suggested" and isinstance(payload, dict):
        title = str(payload.get("title") or "").strip()
        start = str(payload.get("start_at") or "").strip()
        end = str(payload.get("end_at") or "").strip()
        lines: list[str] = []
        if title:
            lines.extend([f"**{title}**", ""])
        if start or end:
            lines.append(f"{start}–{end}".strip("– "))
        location = str(payload.get("location") or "").strip()
        if location:
            lines.append(location)
        notes = str(payload.get("notes") or "").strip()
        if notes:
            lines.append(notes)
        return {
            "confirmation": confirmation,
            "message": "\n".join([line for line in lines if line != ""]),
            "message_format": "markdown",
        }
    if action_id == "todo_item_suggested" and isinstance(payload, dict):
        title = str(payload.get("title") or "").strip()
        snippet = str(payload.get("context_snippet") or "").strip()
        lines: list[str] = []
        if title:
            lines.extend([f"**{title}**", ""])
        if snippet:
            lines.append(snippet)
        return {
            "confirmation": confirmation,
            "message": "\n".join(lines),
            "message_format": "markdown",
        }
    if action_id == "todo_items_suggested" and isinstance(payload, list):
        bullets = []
        for item in payload:
            if isinstance(item, dict):
                t = str(item.get("title") or "").strip()
                if t:
                    bullets.append(f"- {t}")
        return {
            "confirmation": confirmation,
            "message": "\n".join(bullets),
            "message_format": "markdown",
        }
    if action_id == "todo_resolve_suggested" and isinstance(payload, dict):
        title = str(payload.get("title") or "Todo").strip()
        return {
            "confirmation": False,
            "message": f"Mark **{title}** as done?",
            "message_format": "markdown",
        }
    return {"confirmation": confirmation, "message": "", "message_format": "markdown"}


def build_strip_stage_payload(
    attached: dict[str, Any],
    *,
    user_id: int,
    conversation_id: int,
    message_id: int,
) -> dict[str, Any]:
    """Return ``{ area, items }`` for ``emit_ui_stage(run, 'strip', body)``."""
    items: list[dict[str, Any]] = []
    for action_id, raw_payload in attached.items():
        cfg = _STRIP_ACTIONS.get(str(action_id or "").strip())
        if cfg is None or raw_payload is None:
            continue
        digest_payload: Any = raw_payload
        client_payload: Any = raw_payload
        if action_id == "todo_items_suggested" and isinstance(raw_payload, list):
            client_payload = {"items": raw_payload}
        preview = _preview_for(action_id, raw_payload)
        items.append(
            {
                "agent": cfg["agent"],
                "action_id": action_id,
                "description": _description_for(action_id, raw_payload),
                "strip_hash": issue_strip_hash(
                    user_id=user_id,
                    conversation_id=conversation_id,
                    message_id=message_id,
                    action_id=action_id,
                    payload=digest_payload,
                ),
                "confirm_label": cfg["confirm_label"],
                "confirmation": preview["confirmation"],
                "message": preview["message"],
                "message_format": preview["message_format"],
                "conversation_id": conversation_id,
                "message_id": message_id,
                "payload": client_payload,
            }
        )
    return {"area": "strip", "items": items}
