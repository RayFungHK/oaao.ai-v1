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
    logger.info(
        "chat_attachments: execute_chat_run entry run_id=%s count=%s ids=%s",
        run_id,
        len(atts_in),
        [a.get("id") if isinstance(a, dict) else None for a in atts_in[:8]],
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
