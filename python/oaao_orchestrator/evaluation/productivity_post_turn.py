"""Shared post-turn productivity hook helpers (prompt load + transcript)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from oaao_orchestrator.prompt_template import load_template_body, prompts_subdir, render_template_text

DEFAULT_CALENDAR_POST_TURN_REF = "materials/prompts/productivity/calendar_event_post_turn.md"
DEFAULT_TODO_POST_TURN_REF = "materials/prompts/productivity/todo_item_post_turn.md"


def format_turn_transcript(
    messages: list[dict[str, Any]],
    *,
    assistant_text: str,
    max_user_turns: int = 6,
) -> str:
    """Compact user/assistant lines for post-turn classifiers."""
    lines: list[str] = []
    user_count = 0
    for row in messages:
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "").lower()
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        if role == "user":
            user_count += 1
            if user_count > max_user_turns:
                continue
            lines.append(f"User: {content[:2000]}")
        elif role == "assistant":
            lines.append(f"Assistant: {content[:2000]}")
    assistant = (assistant_text or "").strip()
    if assistant:
        lines.append(f"Assistant (latest): {assistant[:4000]}")
    return "\n\n".join(lines).strip()


def llm_cfg_from_chat_request(chat_request: object | None) -> dict[str, Any]:
    """Chat completion endpoint row from the main run request."""
    if chat_request is None:
        return {}
    endpoint = getattr(chat_request, "endpoint", None)
    if endpoint is None:
        return {}
    base_url = str(getattr(endpoint, "base_url", "") or "").strip()
    model = str(getattr(endpoint, "model", "") or "").strip()
    if not base_url or not model:
        return {}
    cfg: dict[str, Any] = {"base_url": base_url, "model": model}
    api_key_env = getattr(endpoint, "api_key_env", None)
    if isinstance(api_key_env, str) and api_key_env.strip():
        cfg["api_key_env"] = api_key_env.strip()
    return cfg


def llm_cfg_from_productivity_purpose(chat_request: object | None, slot: str) -> dict[str, Any]:
    """Dedicated productivity classifier endpoint ({@code productivity.calendar|todo} on payload)."""
    if chat_request is None:
        return {}
    root = getattr(chat_request, "productivity", None)
    if not isinstance(root, dict):
        return {}
    row = root.get(str(slot or "").strip())
    if not isinstance(row, dict):
        return {}
    base_url = str(row.get("base_url") or "").strip()
    model = str(row.get("model") or "").strip()
    if not base_url or not model:
        return {}
    cfg: dict[str, Any] = {"base_url": base_url, "model": model}
    api_key_env = row.get("api_key_env")
    if isinstance(api_key_env, str) and api_key_env.strip():
        cfg["api_key_env"] = api_key_env.strip()
    purpose_key = str(row.get("purpose_key") or "").strip()
    if purpose_key:
        cfg["purpose_key"] = purpose_key
    return cfg


def llm_cfg_for_post_turn(chat_request: object | None, purpose_slot: str) -> dict[str, Any]:
    """Prefer productivity purpose slot; fall back to main chat endpoint."""
    cfg = llm_cfg_from_productivity_purpose(chat_request, purpose_slot)
    if cfg.get("base_url") and cfg.get("model"):
        return cfg
    return llm_cfg_from_chat_request(chat_request)


def load_todo_post_turn_prompt(**variables: Any) -> str:
    variables.setdefault("current_date", datetime.now(UTC).strftime("%Y-%m-%d"))
    variables.setdefault("upcoming_calendar_events", "(none)")
    variables.setdefault("open_todo_items", "(none)")
    body = load_template_body(
        ref=DEFAULT_TODO_POST_TURN_REF,
        search_dirs=(prompts_subdir("productivity"),),
    )
    if not body.strip():
        return (
            "Extract todo tasks as JSON actions[]. Each task is type todo_item_suggested with title, "
            "optional description, confidence 0-1."
        )
    return render_template_text(body, variables)


def load_calendar_post_turn_prompt(**variables: Any) -> str:
    variables.setdefault("current_date", datetime.now(UTC).strftime("%Y-%m-%d"))
    variables.setdefault("upcoming_calendar_events", "(none)")
    variables.setdefault("open_todo_items", "(none)")
    body = load_template_body(
        ref=DEFAULT_CALENDAR_POST_TURN_REF,
        search_dirs=(prompts_subdir("productivity"),),
    )
    if not body.strip():
        return (
            "Extract calendar scheduling intent as JSON actions[]. "
            'Schema: {"actions":[{"type":"calendar_event_suggested",...}]}'
        )
    return render_template_text(body, variables)
