"""Web search — WS-1-S1 delegates to ``knowledge.search_providers``."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.knowledge.search_providers import (
    search_multi,
    searxng_base_url,
)

logger = logging.getLogger(__name__)

__all__ = ["searxng_base_url", "web_search"]


async def web_search(query: str, *, limit: int = 5) -> list[dict[str, Any]]:
    """Return normalized search hits ``[{title, url, snippet, provider?}, ...]``."""
    return await search_multi(query, limit=limit)
