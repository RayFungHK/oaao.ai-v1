"""Deferred ACCS reflection — score in background; coach critique on the *next* user turn."""

from __future__ import annotations

from typing import Any

from oaao_orchestrator.evaluation.accs import ACCSResult
from oaao_orchestrator.evaluation.reflection import build_reflection_critique


def deferred_reflection_enabled() -> bool:
    from oaao_orchestrator.evaluation.inline_reflection import inline_reflection_enabled

    return inline_reflection_enabled()


def build_deferred_reflection_reasons(accs: ACCSResult) -> dict[str, Any]:
    """Extra ``accs_reasons_json`` fields when ACCS action is ``reflect`` (next-turn coaching)."""
    critique = build_reflection_critique(accs)
    return {
        "reflection_deferred": True,
        "reflection_pending_next_turn": True,
        "reflection_consumed": False,
        "reflection_critique": critique,
        "reflection_initial_score": round(float(accs.score), 4),
        "reflection_factors": {k: round(float(v), 4) for k, v in (accs.factors or {}).items()},
    }


def build_accs_reflection_system_block(ctx: dict[str, Any]) -> str:
    """System context injected before compose on the turn after a deferred ACCS review."""
    critique = str(ctx.get("reflection_critique") or "").strip()
    if not critique:
        return ""
    score = ctx.get("reflection_initial_score")
    score_line = f"Prior reply ACCS score: {score:.2f}.\n" if isinstance(score, (int, float)) else ""
    assistant_id = ctx.get("assistant_message_id")
    id_line = f"Reviewed assistant message id: {assistant_id}.\n" if assistant_id else ""
    return (
        "[ACCS coach review — apply on this turn only]\n"
        "The previous assistant reply was scored below quality threshold. "
        "Do not repeat the same gaps; improve grounding, alignment, and completeness.\n"
        f"{score_line}{id_line}\n"
        f"{critique}"
    )
