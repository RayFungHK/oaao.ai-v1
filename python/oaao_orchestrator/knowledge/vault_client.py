"""WS-1-S4 — internal Vault text upload for web knowledge assets."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def vault_api_base_url() -> str:
    return (os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL") or "").strip().rstrip("/")


def document_upload_text_url() -> str:
    base = vault_api_base_url()
    if not base:
        return ""
    return f"{base}/document_upload_text"


def _internal_headers() -> dict[str, str]:
    from oaao_orchestrator.research.worker import _internal_headers as _rh

    return _rh()


async def upload_text_document(
    client: httpx.AsyncClient,
    *,
    user_id: int,
    vault_id: int,
    filename: str,
    content: str,
    workspace_id: int | None = None,
    container_id: int | None = None,
    asset_id: str | None = None,
    content_hash: str | None = None,
    canonical_url: str | None = None,
) -> dict[str, Any] | None:
    """POST ``/vault/api/document_upload_text`` — returns PHP JSON or None."""
    url = document_upload_text_url()
    if not url or user_id < 1 or vault_id < 1 or not content.strip():
        return None
    payload: dict[str, Any] = {
        "user_id": user_id,
        "vault_id": vault_id,
        "filename": filename,
        "content": content,
        "mime_type": "text/markdown",
        "source": "web_search",
    }
    if workspace_id and workspace_id > 0:
        payload["workspace_id"] = workspace_id
    if container_id and container_id > 0:
        payload["container_id"] = container_id
    if asset_id:
        payload["web_search_asset_id"] = asset_id
    if content_hash:
        payload["content_hash"] = content_hash
    if canonical_url and canonical_url.strip():
        payload["canonical_url"] = canonical_url.strip()
    try:
        resp = await client.post(
            url,
            json=payload,
            headers=_internal_headers(),
            timeout=httpx.Timeout(120.0, connect=15.0),
        )
        if resp.status_code >= 400:
            logger.warning(
                "vault document_upload_text %s -> %s",
                url,
                resp.status_code,
            )
            return None
        data = resp.json()
        return data if isinstance(data, dict) else None
    except Exception:  # noqa: BLE001
        logger.warning("vault document_upload_text failed", exc_info=True)
        return None
