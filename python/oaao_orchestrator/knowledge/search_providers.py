"""WS-1-S1 — SearchProvider abstraction (SearXNG adapter + registry)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SearchHit:
    title: str
    url: str
    snippet: str
    provider: str = "searxng"

    def as_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "provider": self.provider,
        }


@runtime_checkable
class SearchProvider(Protocol):
    provider_id: str

    async def search(self, query: str, *, limit: int = 5) -> list[SearchHit]:
        ...


def searxng_base_url() -> str:
    return (
        (os.environ.get("OAAO_SEARXNG_URL") or os.environ.get("OAAO_WEB_SEARCH_URL") or "")
        .strip()
        .rstrip("/")
    )


class SearxngProvider:
    """L0 meta-search — engines configured on the SearXNG instance."""

    provider_id = "searxng"

    def __init__(self, base_url: str | None = None) -> None:
        self._base = (base_url or searxng_base_url()).rstrip("/")

    async def search(self, query: str, *, limit: int = 5) -> list[SearchHit]:
        q = (query or "").strip()
        if not q or not self._base:
            if not self._base:
                logger.info("searxng search skipped — OAAO_SEARXNG_URL not set")
            return []
        cap = max(1, min(int(limit), 10))
        params = urlencode({"q": q, "format": "json"})
        url = f"{self._base}/search?{params}"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
                resp = await client.get(url, headers={"Accept": "application/json"})
                if resp.status_code >= 400:
                    return []
                data = resp.json()
        except Exception:  # noqa: BLE001
            logger.warning("searxng search request failed", exc_info=True)
            return []
        results = data.get("results") if isinstance(data, dict) else None
        if not isinstance(results, list):
            return []
        out: list[SearchHit] = []
        for row in results[:cap]:
            if not isinstance(row, dict):
                continue
            title = str(row.get("title") or "").strip()
            link = str(row.get("url") or row.get("link") or "").strip()
            snippet = str(row.get("content") or row.get("snippet") or "").strip()[:500]
            if title or link:
                out.append(
                    SearchHit(
                        title=title,
                        url=link,
                        snippet=snippet,
                        provider=self.provider_id,
                    )
                )
        return out


_PROVIDERS: dict[str, SearchProvider] = {}


def register_search_provider(provider: SearchProvider) -> None:
    pid = str(getattr(provider, "provider_id", "") or "").strip()
    if pid:
        _PROVIDERS[pid] = provider


def get_search_provider(provider_id: str | None = None) -> SearchProvider | None:
    pid = (provider_id or os.environ.get("OAAO_WEB_SEARCH_PROVIDER") or "searxng").strip().lower()
    if pid in _PROVIDERS:
        return _PROVIDERS[pid]
    if pid == "searxng":
        inst = SearxngProvider()
        if inst._base:
            register_search_provider(inst)
            return inst
    return None


def default_provider_priority() -> list[str]:
    raw = (os.environ.get("OAAO_WEB_SEARCH_PROVIDER_PRIORITY") or "searxng").strip()
    return [p.strip().lower() for p in raw.split(",") if p.strip()]


async def search_multi(
    query: str,
    *,
    limit: int = 5,
    provider_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Try providers in order; return normalized hit dicts (deduped by URL)."""
    ids = provider_ids or default_provider_priority()
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    cap = max(1, min(int(limit), 10))
    for pid in ids:
        prov = get_search_provider(pid)
        if prov is None:
            continue
        hits = await prov.search(query, limit=cap)
        for hit in hits:
            url = (hit.url or "").strip()
            key = url.lower() if url else hit.title.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(hit.as_dict())
            if len(out) >= cap:
                return out
    return out


register_search_provider(SearxngProvider())
