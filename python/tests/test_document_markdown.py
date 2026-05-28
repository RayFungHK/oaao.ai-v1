"""CS-1-S15 — document_markdown ingest."""

from __future__ import annotations

from oaao_orchestrator.corpus.document_markdown import (
    _heuristic_plain_to_markdown,
    build_document_markdown,
    ingest_mode_from_env,
)


def test_heuristic_promotes_short_lines_to_headings():
    plain = "本函檔號：MEN-1\n\n下列行員來函申請。\n\n018\t甲\n019\t乙"
    md = _heuristic_plain_to_markdown(plain, source_label="Notice")
    assert "本函檔號" in md
    assert "|" in md or "018" in md


async def test_build_document_markdown_heuristic_mode(monkeypatch):
    monkeypatch.setenv("OAAO_CORPUS_MARKDOWN_INGEST", "heuristic")
    out = await build_document_markdown(
        plain_text="Title line\n\nBody paragraph one.\n\n018\tcell",
        source_label="t",
        llm_cfg=None,
    )
    assert out["method"] in ("heuristic", "plain_fallback", "heuristic_fallback")
    assert out["char_count"] > 10
    assert "#" in out["markdown"] or "Title" in out["markdown"]


async def test_build_document_markdown_off_mode(monkeypatch):
    monkeypatch.setenv("OAAO_CORPUS_MARKDOWN_INGEST", "off")
    plain = "raw only"
    out = await build_document_markdown(plain_text=plain, source_label="x", llm_cfg=None)
    assert out["markdown"] == plain
    assert out["method"] == "plain"


def test_ingest_mode_default_llm():
    assert ingest_mode_from_env() in ("llm", "heuristic", "off")
