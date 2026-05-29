"""CS-6-S4 — SSE status event for todo suggestions."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.streaming.events import PHASE_SYSTEM, StreamEnvelope
from oaao_orchestrator.streaming.session import StreamRun

logger = logging.getLogger(__name__)


async def emit_todo_item_suggested_status(
    run: StreamRun,
    payload: dict[str, Any],
) -> None:
    if not payload or not str(payload.get("title") or "").strip():
        return
    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind="status",
            text="todo_item_suggested",
            payload=payload,
        )
    )
    logger.info(
        "todo_item_suggested stream conversation_id=%s confidence=%s",
        payload.get("conversation_id"),
        payload.get("confidence"),
    )


async def emit_todo_items_suggested_status(
    run: StreamRun,
    *,
    conversation_id: int,
    items: list[dict[str, Any]],
) -> None:
    """Batch suggestion — one SSE event with multiple tasks."""
    cleaned: list[dict[str, Any]] = []
    for idx, row in enumerate(items):
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if len(title) < 4:
            continue
        cleaned.append({**row, "title": title, "suggestion_index": idx})
    if len(cleaned) < 2:
        return
    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind="status",
            text="todo_items_suggested",
            payload={
                "conversation_id": conversation_id,
                "items": cleaned,
            },
        )
    )
    logger.info(
        "todo_items_suggested stream conversation_id=%s count=%s",
        conversation_id,
        len(cleaned),
    )
