"""Emit skill suggestion hints on the live SSE stream (CS-4-S3)."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.streaming.events import PHASE_SYSTEM, StreamEnvelope
from oaao_orchestrator.streaming.session import StreamRun

logger = logging.getLogger(__name__)


async def emit_skill_suggested_status(
    run: StreamRun,
    payload: dict[str, Any],
) -> None:
    if not payload or not str(payload.get("proposed_title") or "").strip():
        return
    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind="status",
            text="skill_suggested",
            payload=payload,
        )
    )
    logger.info(
        "skill_suggested stream conversation_id=%s confidence=%s",
        payload.get("conversation_id"),
        payload.get("confidence"),
    )
