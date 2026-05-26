"""HTTP client for Lance multimodal worker (optional OAAO_LANCE_BASE_URL)."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def lance_base_url() -> str:
    raw = os.environ.get("OAAO_LANCE_BASE_URL", "").strip()
    return raw.rstrip("/")


async def run_lance_task(
    client: httpx.AsyncClient,
    *,
    task: str,
    inputs: dict[str, Any],
    base_url: str | None = None,
) -> dict[str, Any] | None:
    """POST task to Lance sidecar; returns None when URL unset (caller uses stub)."""
    base = (base_url or lance_base_url()).strip().rstrip("/")
    if not base:
        return None
    url = f"{base}/v1/task"
    try:
        r = await client.post(url, json={"task": task, "inputs": inputs}, timeout=httpx.Timeout(300.0, connect=10.0))
    except httpx.RequestError as exc:
        logger.warning("lance task request failed task=%s: %s", task, exc)
        return {"ok": False, "error": "lance_unreachable", "detail": str(exc)}
    if r.status_code >= 400:
        logger.warning("lance task HTTP %s task=%s body=%s", r.status_code, task, r.text[:300])
        return {"ok": False, "error": f"lance_http_{r.status_code}", "detail": r.text[:500]}
    try:
        payload = r.json()
    except ValueError:
        return {"ok": False, "error": "lance_non_json"}
    if isinstance(payload, dict):
        payload.setdefault("ok", True)
        payload.setdefault("backend", "python_module")
        payload.setdefault("python_module", "mm_lance")
        payload.setdefault("task", task)
        return payload
    return {"ok": False, "error": "lance_invalid_payload"}
