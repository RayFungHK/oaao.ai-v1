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


async def web_search(
    query: str,
    *,
    limit: int = 5,
    language: str | None = None,
    display_locale: str | None = None,
) -> list[dict[str, Any]]:
    """Return normalized search hits ``[{title, url, snippet, provider?}, ...]``."""
    from oaao_orchestrator.knowledge.search_language import resolve_searxng_language

    lang = language or resolve_searxng_language(display_locale=display_locale)
    return await search_multi(query, limit=limit, language=lang)
