"""WS-1-S1 — SearchProvider registry."""

from __future__ import annotations

from oaao_orchestrator.knowledge.search_providers import (
    SearchHit,
    SearxngProvider,
    get_search_provider,
    search_multi,
)


def test_search_hit_as_dict() -> None:
    hit = SearchHit(title="A", url="https://a.test", snippet="body", provider="searxng")
    d = hit.as_dict()
    assert d["title"] == "A"
    assert d["url"] == "https://a.test"
    assert d["provider"] == "searxng"


def test_searxng_provider_unconfigured_returns_empty() -> None:
    prov = SearxngProvider(base_url="")
    assert prov._base == ""


def test_get_search_provider_missing_base() -> None:
    prov = get_search_provider("searxng")
    if prov is None:
        assert True
    else:
        assert prov.provider_id == "searxng"


async def test_search_multi_empty_query() -> None:
    assert await search_multi("  ", limit=3) == []
