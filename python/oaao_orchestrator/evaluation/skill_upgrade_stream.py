"""Emit skill upgrade suggestion on live SSE stream (CS-4-S7)."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.streaming.events import PHASE_SYSTEM, StreamEnvelope
from oaao_orchestrator.streaming.session import StreamRun

logger = logging.getLogger(__name__)


async def emit_skill_upgrade_suggested_status(
    run: StreamRun,
    payload: dict[str, Any],
) -> None:
    if not payload or not str(payload.get("skill_id") or "").strip():
        return
    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind="status",
            text="skill_upgrade_suggested",
            payload=payload,
        )
    )
    logger.info(
        "skill_upgrade_suggested stream skill_id=%s usage=%s",
        payload.get("skill_id"),
        payload.get("usage_count"),
    )
