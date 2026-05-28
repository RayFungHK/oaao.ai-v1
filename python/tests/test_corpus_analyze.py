"""CS-1-S6 — corpus analyze worker smoke tests."""

from __future__ import annotations

import asyncio

import pytest

from oaao_orchestrator.corpus.worker import run_corpus_analyze


@pytest.mark.asyncio
async def test_corpus_analyze_inline_text(tmp_path):
    p = tmp_path / "sample.txt"
    p.write_text("Hello world.\n\nSecond paragraph with more detail.", encoding="utf-8")

    payload = {
        "corpus_id": 1,
        "sources": [
            {
                "kind": "upload",
                "source_id": 10,
                "absolute_path": str(p),
                "mime_type": "text/plain",
                "label": "sample.txt",
            },
        ],
        "segment_cap": 50,
    }
    out = await run_corpus_analyze(payload)
    assert out.get("ok") is True
    segments = out.get("segments")
    assert isinstance(segments, list) and len(segments) >= 1
    style = out.get("style_json")
    assert isinstance(style, dict) and style.get("version") == 1


@pytest.mark.asyncio
async def test_corpus_analyze_resolves_relative_under_storage_root(tmp_path):
    root = tmp_path / "corpus"
    root.mkdir()
    rel = "t1/ws/doc.pdf"
    target = root / rel
    target.parent.mkdir(parents=True)
    target.write_bytes(b"%PDF-1.4\n% minimal stub - real PDFs need pypdf/pymupdf in orchestrator\n")

    payload = {
        "corpus_id": 2,
        "corpus_storage_root": str(root),
        "sources": [
            {
                "kind": "upload",
                "source_id": 11,
                "absolute_path": "/var/www/html/storage/corpus/does-not-exist.pdf",
                "relative_path": rel.replace("\\", "/"),
                "mime_type": "application/pdf",
                "file_name": "doc.pdf",
                "label": "doc.pdf",
            },
        ],
        "segment_cap": 10,
    }
    out = await run_corpus_analyze(payload)
    # Path resolution should find the file; extraction may still fail on stub bytes.
    assert out.get("error") in {None, "no_extractable_text"}
    if out.get("ok"):
        assert isinstance(out.get("segments"), list)
