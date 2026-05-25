"""Dispose ephemeral chat attachment bytes after orchestrator ATTACHMENTS task."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.php_boundary import assert_php_http_allowed, php_chat_api_base

logger = logging.getLogger(__name__)


async def dispose_chat_attachments(
    client: httpx.AsyncClient,
    *,
    conversation_id: int,
    user_id: int,
    attachment_ids: list[int],
    shared_secret: str,
) -> bool:
    """Delete attachment files + DB rows via PHP internal route."""
    ids = [int(x) for x in attachment_ids if int(x) > 0]
    if not ids or conversation_id < 1 or user_id < 1:
        return True

    url = f"{php_chat_api_base()}/attachments_dispose"
    assert_php_http_allowed(url, context="attachments_dispose")
    body: dict[str, Any] = {
        "conversation_id": conversation_id,
        "user_id": user_id,
        "attachment_ids": ids,
    }
    try:
        r = await client.post(
            url,
            headers={
                "Content-Type": "application/json",
                "X-OAAO-Internal-Token": shared_secret,
                "X-Requested-With": "XMLHttpRequest",
            },
            json=body,
        )
        if r.status_code >= 400:
            logger.warning("attachments_dispose HTTP %s — %s", r.status_code, r.text[:300])
            return False
        return True
    except httpx.RequestError as exc:
        logger.debug("attachments_dispose failed: %s", exc)
        return False
