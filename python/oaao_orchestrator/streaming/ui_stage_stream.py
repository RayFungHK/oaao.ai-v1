"""Pipeline UI stage envelopes — update chat shell areas after message body."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.streaming.events import KIND_STAGE, PHASE_UI, StreamEnvelope
from oaao_orchestrator.streaming.session import StreamRun

logger = logging.getLogger(__name__)

_VALID_AREAS = frozenset({"task", "message", "agent", "info", "state", "strip"})


async def emit_ui_stage(
    run: StreamRun,
    area: str,
    payload: dict[str, Any] | None = None,
) -> None:
    """Emit ``phase=ui, kind=stage`` — UI routes by ``payload.area`` (see chat-ui-areas.md)."""
    key = str(area or "").strip().lower()
    if key not in _VALID_AREAS:
        logger.warning("emit_ui_stage skipped unknown area=%s", area)
        return
    body: dict[str, Any] = {"area": key}
    if isinstance(payload, dict):
        body.update(payload)
    await run.append(
        StreamEnvelope(
            phase=PHASE_UI,
            kind=KIND_STAGE,
            text=key,
            payload=body,
        )
    )
