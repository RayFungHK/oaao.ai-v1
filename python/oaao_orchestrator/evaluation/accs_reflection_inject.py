"""Inject deferred ACCS coach critique into the next chat turn (from PHP ``accs_reflection_context``)."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def apply_accs_reflection_context(*, req: object, messages_for_llm: list[Any]) -> bool:
    """Prepend coach critique when PHP passed pending deferred reflection for the prior turn."""
    raw = getattr(req, "accs_reflection_context", None)
    if not isinstance(raw, dict):
        return False
    if raw.get("reflection_consumed"):
        return False
    critique = str(raw.get("reflection_critique") or "").strip()
    if not critique:
        return False

    from oaao_orchestrator.evaluation.deferred_reflection import build_accs_reflection_system_block
    from oaao_orchestrator.vault_rag.messages import inject_system_message

    block = build_accs_reflection_system_block(raw)
    if not block:
        return False
    inject_system_message(messages_for_llm, block)
    logger.info(
        "accs_reflection_injected assistant_message_id=%s score=%s",
        raw.get("assistant_message_id"),
        raw.get("reflection_initial_score"),
    )
    return True
