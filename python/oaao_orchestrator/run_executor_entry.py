"""Top-20 #6 phase 14 — entry-time helpers extracted.

The opening of :func:`execute_chat_run` previously inlined two side-effect
blocks: the chat_attachments entry log and the tool_servers registration
loop. Those folds into :func:`log_chat_attachments_entry` and
:func:`register_request_tool_servers` here so the caller's prelude reads as
two named operations rather than ~25 lines of dict munging.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def log_chat_attachments_entry(*, run_id: str, req: Any) -> None:
    """Emit the chat_attachments entry log line."""
    atts_in = list(getattr(req, "chat_attachments", None) or [])
    mm_u = getattr(req, "mm_understand", None)
    logger.info(
        "chat_attachments: execute_chat_run entry run_id=%s count=%s ids=%s mm_understand=%s",
        run_id,
        len(atts_in),
        [a.get("id") if isinstance(a, dict) else None for a in atts_in[:8]],
        isinstance(mm_u, dict),
    )


def register_request_tool_servers(*, req: Any) -> None:
    """Register every well-formed ``tool_servers`` row on the request."""
    from oaao_orchestrator.tools.registry import (
        ToolServerSpec,
        register_tool_server,
    )

    for row in getattr(req, "tool_servers", None) or []:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("id") or "").strip()
        base = str(row.get("base_url") or "").strip()
        if sid and base:
            purposes = row.get("allowed_purposes")
            allowed = [str(p) for p in purposes] if isinstance(purposes, list) else ["chat"]
            spec = row.get("openapi_spec")
            register_tool_server(
                ToolServerSpec(
                    id=sid,
                    base_url=base.rstrip("/"),
                    openapi_url=str(row.get("openapi_url") or "/openapi.json"),
                    allowed_purposes=allowed,
                    openapi_spec=spec if isinstance(spec, dict) else None,
                )
            )


def register_request_hot_plug_skills(*, req: Any) -> None:
    """Register hot-plug skills from PHP manifest (per-request, no orchestrator restart)."""
    from oaao_orchestrator.skills.hot_plug import register_request_hot_plug_skills as _register

    rows = getattr(req, "hot_plug_skills", None) or []
    _register(rows if isinstance(rows, list) else [])


def apply_request_material_grounding(*, req: Any, messages_for_llm: list[Any]) -> None:
    """Apply conversation material grounding to ``messages_for_llm`` in place.

    Replicates the pre-loop reuse-turn detection: integer
    ``reuse_grounding_message_id > 0``, or a ``slide_designer`` dict that
    sets ``regenerate_deck`` / ``continuation`` / a non-empty
    ``active_material_id``.
    """
    material_grounding = list(
        getattr(req, "conversation_material_grounding", None) or [],
    )
    reuse_grounding_msg = getattr(req, "reuse_grounding_message_id", None)
    reuse_grounding_turn = False
    try:
        reuse_grounding_turn = int(reuse_grounding_msg or 0) > 0
    except (TypeError, ValueError):
        reuse_grounding_turn = False
    sd_for_reuse = req.slide_designer if isinstance(req.slide_designer, dict) else {}
    if isinstance(sd_for_reuse, dict) and (
        sd_for_reuse.get("regenerate_deck")
        or sd_for_reuse.get("continuation")
        or str(sd_for_reuse.get("active_material_id") or "").strip()
    ):
        reuse_grounding_turn = True
    if material_grounding:
        from oaao_orchestrator.material_grounding import (
            apply_conversation_material_grounding,
        )

        apply_conversation_material_grounding(
            messages_for_llm,
            material_grounding,
            reuse_turn=reuse_grounding_turn,
        )


def apply_user_personalization(*, req: Any, messages_for_llm: list[Any]) -> None:
    """Inject user profile / knowledge / local time from PHP personalization settings."""
    from oaao_orchestrator.user_personalization import apply_user_personalization as _apply

    _apply(req=req, messages_for_llm=messages_for_llm)
