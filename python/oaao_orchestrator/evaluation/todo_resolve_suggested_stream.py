"""CS-6-S7 — SSE hint to resolve an open todo from the thread."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.streaming.events import PHASE_SYSTEM, StreamEnvelope
from oaao_orchestrator.streaming.session import StreamRun

logger = logging.getLogger(__name__)


async def emit_todo_resolve_suggested_status(
    run: StreamRun,
    payload: dict[str, Any],
) -> None:
    if not payload or int(payload.get("todo_id") or 0) < 1:
        return
    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind="status",
            text="todo_resolve_suggested",
            payload=payload,
        )
    )
    logger.info(
        "todo_resolve_suggested stream conversation_id=%s todo_id=%s",
        payload.get("conversation_id"),
        payload.get("todo_id"),
    )
