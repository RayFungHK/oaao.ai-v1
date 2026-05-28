"""Backward-compatible re-exports — prefer ``conversation_intent`` (AUDIT-5)."""

from __future__ import annotations

from oaao_orchestrator.slide_project.conversation_intent import (
    text_signals_personal_record_lookup,
    text_signals_vault_grounding,
    wants_handbook_teaching_outline,
)

__all__ = [
    "text_signals_personal_record_lookup",
    "text_signals_vault_grounding",
    "wants_handbook_teaching_outline",
]
