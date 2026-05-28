"""CS-2-S7 — library blocks, embed, search."""

from __future__ import annotations

import pytest

from oaao_orchestrator.library.blocks import blocks_to_markdown, chunk_markdown
from oaao_orchestrator.library.qdrant import library_collection_name


def test_blocks_to_markdown():
    blocks = [
        {"type": "heading", "level": 2, "content": "Section A"},
        {"type": "paragraph", "content": "Hello world."},
        {"type": "bullet_list", "content": "one\ntwo"},
    ]
    md = blocks_to_markdown(blocks, title="Doc")
    assert "# Doc" in md
    assert "## Section A" in md
    assert "- one" in md


def test_chunk_markdown_splits_long_text():
    para = "word " * 900
    chunks = chunk_markdown(para, chunk_size=500, overlap=50)
    assert len(chunks) >= 2
    assert all(len(c) <= 500 for c in chunks)


def test_library_collection_name_tenant_scoped():
    assert library_collection_name(42) == "library_42"


@pytest.mark.asyncio
async def test_run_library_embed_requires_config(monkeypatch):
    from oaao_orchestrator.library.embed import run_library_embed

    monkeypatch.delenv("OAAO_EMBEDDING_URL", raising=False)
    out = await run_library_embed(
        {
            "tenant_id": 1,
            "document_id": 2,
            "blocks": [{"type": "paragraph", "content": "hello"}],
        }
    )
    assert out["ok"] is False
    assert out["error"] == "embedding_not_configured"


@pytest.mark.asyncio
async def test_run_library_search_requires_query():
    from oaao_orchestrator.library.search import run_library_search

    out = await run_library_search({"tenant_id": 1, "query": ""})
    assert out["ok"] is False
    assert out["error"] == "query_required"
