"""Emit calendar event suggestion hints on the live SSE stream (CS-5-S5)."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.streaming.events import PHASE_SYSTEM, StreamEnvelope
from oaao_orchestrator.streaming.session import StreamRun

logger = logging.getLogger(__name__)


async def emit_calendar_event_suggested_status(
    run: StreamRun,
    payload: dict[str, Any],
) -> None:
    if not payload or not str(payload.get("title") or "").strip():
        return
    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind="status",
            text="calendar_event_suggested",
            payload=payload,
        )
    )
    logger.info(
        "calendar_event_suggested stream conversation_id=%s confidence=%s",
        payload.get("conversation_id"),
        payload.get("confidence"),
    )
