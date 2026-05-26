"""Emit thread health hints on the live SSE stream (P1-3)."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.evaluation.conversation_health import (
    ConversationHealth,
    TurnScorePoint,
    analyze_conversation_health,
)
from oaao_orchestrator.streaming.events import PHASE_SYSTEM, StreamEnvelope
from oaao_orchestrator.streaming.session import StreamRun

logger = logging.getLogger(__name__)


def provisional_health_from_accs(
    *,
    conversation_id: int,
    accs_score: float,
    user_message: str = "",
) -> ConversationHealth | None:
    """Single-turn hint before post-stream persist catches up."""
    if accs_score <= 0 or accs_score >= 0.65:
        return None
    health = analyze_conversation_health(
        conversation_id,
        [
            TurnScorePoint(
                turn_index=1,
                accs=accs_score,
                user_message=user_message,
            )
        ],
    )
    if health.alert == "none":
        health.alert = "quality_drop"
        health.alerts = ["quality_drop"]
    return health


async def emit_conversation_health_status(
    run: StreamRun,
    health: ConversationHealth | dict[str, Any],
) -> None:
    payload = health.to_dict() if isinstance(health, ConversationHealth) else dict(health)
    if str(payload.get("alert") or "none") == "none":
        return
    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind="status",
            text="conversation_health",
            payload=payload,
        )
    )
    logger.info(
        "conversation_health stream alert=%s conversation_id=%s",
        payload.get("alert"),
        payload.get("conversation_id"),
    )
