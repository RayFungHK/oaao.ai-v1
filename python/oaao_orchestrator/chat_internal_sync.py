"""One-shot PHP adjunct sync (materials / slide registry) after orchestrator persist."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.php_boundary import assert_php_http_allowed, php_chat_api_base
from oaao_orchestrator.run_principal import RunPrincipal

logger = logging.getLogger(__name__)


async def sync_adjunct_via_php(
    *,
    principal: RunPrincipal,
    meta: dict[str, Any],
    shared_secret: str,
) -> bool:
    """Call PHP internal route — slide_project + materials sync only (no content rewrite)."""
    if not meta:
        return False
    needs = (
        bool(meta.get("slide_project"))
        or bool(meta.get("materials"))
        or bool((meta.get("conversation_title") or "").strip())
        or bool(
            isinstance(meta.get("oaao_pipeline"), dict)
            and isinstance(meta["oaao_pipeline"].get("artifacts"), list)
            and meta["oaao_pipeline"]["artifacts"]
        )
    )
    if not needs:
        return False
    url = f"{php_chat_api_base()}/assistant_internal_sync"
    assert_php_http_allowed(url, context="assistant_internal_sync")
    from oaao_orchestrator.run_principal import issue_token

    body = {
        "conversation_id": principal.conversation_id,
        "assistant_message_id": principal.assistant_message_id,
        "user_id": principal.user_id,
        "workspace_id": principal.workspace_id,
        "tenant_id": principal.tenant_id,
        "meta": meta,
        "run_principal": issue_token(
            user_id=principal.user_id,
            conversation_id=principal.conversation_id,
            assistant_message_id=principal.assistant_message_id,
            workspace_id=principal.workspace_id,
            tenant_id=principal.tenant_id,
            secret=shared_secret,
        ),
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=5.0)) as client:
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
            logger.warning("assistant_internal_sync HTTP %s — %s", r.status_code, r.text[:300])
            return False
        return True
    except httpx.RequestError as exc:
        logger.debug("assistant_internal_sync failed: %s", exc)
        return False
