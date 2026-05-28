"""Record micro skill usage via PHP internal API (CS-4-S7)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.php_boundary import assert_php_http_allowed, php_chat_api_base
from oaao_orchestrator.run_principal import RunPrincipal, issue_token

logger = logging.getLogger(__name__)


async def record_skill_usage_via_php(
    *,
    principal: RunPrincipal,
    skill_ids: list[str],
    shared_secret: str,
) -> list[dict[str, Any]]:
    """Bump usage_count for skill_ids; return updated skill rows from PHP."""
    ids = [x.strip() for x in skill_ids if isinstance(x, str) and x.strip()]
    if not ids:
        return []
    url = f"{php_chat_api_base()}/skills_usage_record"
    assert_php_http_allowed(url, context="skills_usage_record")
    body = {
        "user_id": principal.user_id,
        "conversation_id": principal.conversation_id,
        "assistant_message_id": principal.assistant_message_id,
        "workspace_id": principal.workspace_id,
        "tenant_id": principal.tenant_id,
        "skill_ids": ids[:12],
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
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
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
            logger.warning("skills_usage_record HTTP %s — %s", r.status_code, r.text[:300])
            return []
        data = r.json()
        if not isinstance(data, dict) or not data.get("success"):
            return []
        inner = data.get("data")
        if isinstance(inner, dict):
            rows = inner.get("skills")
            if isinstance(rows, list):
                return [x for x in rows if isinstance(x, dict)]
    except httpx.RequestError as exc:
        logger.debug("skills_usage_record failed: %s", exc)
    return []
