"""CS-1-S11 — analyze output includes schema-driven meta."""

from __future__ import annotations

import asyncio

import pytest

from oaao_orchestrator.corpus.worker import run_corpus_analyze


@pytest.mark.asyncio
async def test_analyze_writes_document_type_meta(tmp_path):
    p = tmp_path / "memo.txt"
    p.write_text(
        "MEMO\n\nSubject: Policy update\n\nBody paragraph one.\n\nBody paragraph two.",
        encoding="utf-8",
    )
    payload = {
        "corpus_id": 99,
        "sources": [
            {
                "kind": "upload",
                "source_id": 1,
                "absolute_path": str(p),
                "mime_type": "text/plain",
                "label": "memo.txt",
            },
        ],
        "segment_cap": 20,
    }
    out = await run_corpus_analyze(payload)
    assert out.get("ok") is True
    style = out.get("style_json")
    assert isinstance(style, dict)
    meta = style.get("meta")
    assert isinstance(meta, dict)
    assert "document_markdown" in meta or meta.get("document_type") is not None
