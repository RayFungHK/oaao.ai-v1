"""Web search via SearXNG (Phase 10 minimal path)."""

from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)


def searxng_base_url() -> str:
    return (
        (os.environ.get("OAAO_SEARXNG_URL") or os.environ.get("OAAO_WEB_SEARCH_URL") or "")
        .strip()
        .rstrip("/")
    )


async def web_search(query: str, *, limit: int = 5) -> list[dict[str, Any]]:
    """Return normalized search hits ``[{title, url, snippet}, ...]``."""
    q = (query or "").strip()
    if not q:
        return []
    base = searxng_base_url()
    if not base:
        logger.info("web_search skipped — OAAO_SEARXNG_URL not set")
        return []
    params = urlencode({"q": q, "format": "json"})
    url = f"{base}/search?{params}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
            resp = await client.get(url, headers={"Accept": "application/json"})
            if resp.status_code >= 400:
                return []
            data = resp.json()
    except Exception:  # noqa: BLE001
        logger.warning("web_search request failed", exc_info=True)
        return []
    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, list):
        return []
    out: list[dict[str, Any]] = []
    for row in results[: max(1, min(limit, 10))]:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        link = str(row.get("url") or row.get("link") or "").strip()
        snippet = str(row.get("content") or row.get("snippet") or "").strip()
        if title or link:
            out.append({"title": title, "url": link, "snippet": snippet[:500]})
    return out
