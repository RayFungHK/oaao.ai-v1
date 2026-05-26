"""Report mine LLM usage to PHP usage ledger."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.php_boundary import assert_php_http_allowed

logger = logging.getLogger(__name__)


def _shared_secret() -> str:
    from oaao_orchestrator._internal_secret import require_internal_secret

    return require_internal_secret()


def _php_api_base() -> str:
    return (
        os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL", "http://web/vault/api").strip().rstrip("/")
    )


async def report_mine_llm_usage(
    *,
    tenant_id: int,
    user_id: int,
    mine_id: int | None,
    usage: dict[str, Any] | None,
) -> None:
    if tenant_id < 1 or not usage:
        return
    pt = usage.get("prompt_tokens")
    ct = usage.get("completion_tokens")
    try:
        total = float(int(pt or 0) + int(ct or 0))
    except (TypeError, ValueError):
        total = 0.0
    if total <= 0:
        return

    url = f"{_php_api_base()}/usage_record"
    assert_php_http_allowed(url, context="usage_record")
    meta: dict[str, Any] = {
        "purpose_key": "mine.primary",
        "prompt_tokens": pt,
        "completion_tokens": ct,
    }
    if user_id > 0:
        meta["user_id"] = user_id
    if mine_id is not None and mine_id > 0:
        meta["mine_id"] = mine_id

    body = {
        "tenant_id": tenant_id,
        "event_kind": "chat.completion",
        "quantity": total,
        "unit": "tokens",
        "purpose_key": "mine.primary",
        "meta": meta,
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "X-OAAO-Internal-Token": _shared_secret(),
                },
                json=body,
            )
    except Exception as exc:  # noqa: BLE001
        logger.debug("mine usage_record failed: %s", exc)
