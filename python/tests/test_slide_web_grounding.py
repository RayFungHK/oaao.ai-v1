"""Slide designer — web search + vault grounding for outline LLM."""

from __future__ import annotations

from oaao_orchestrator.slide_project.llm import _ensure_outline_scripts
from oaao_orchestrator.slide_project.outline_markdown import apply_outline_fields_from_llm_row
from oaao_orchestrator.slide_project.rag_context import (
    resolve_slide_grounding_for_slides,
    slide_grounding_user_block,
    web_search_grounding_from_messages,
)


def test_web_search_grounding_from_messages() -> None:
    msgs = [
        {"role": "user", "content": "搜索 DJI Pocket 4P 的規格，做一份宣傳 slide"},
        {
            "role": "system",
            "content": "--- Web search results ---\n[W1] DJI Pocket 4 — https://dji.com\n1-inch sensor",
        },
    ]
    out = web_search_grounding_from_messages(msgs)
    assert "DJI Pocket 4" in out
    assert "[W1]" in out


def test_resolve_slide_grounding_merges_web_and_vault() -> None:
    msgs = [
        {
            "role": "system",
            "content": "Optional vault excerpts ---\nHandbook line about wallets.",
        },
        {
            "role": "system",
            "content": "--- Web search results ---\n[W1] Spec — https://x\nSnippet",
        },
    ]
    hits = [{"title": "Spec", "url": "https://x", "snippet": "Snippet"}]
    out = resolve_slide_grounding_for_slides(
        msgs,
        pipeline_snap={"web_search_hits": hits},
    )
    assert "Web search results" in out
    assert "Handbook" in out or "vault" in out.lower()


def test_slide_grounding_user_block_web_label() -> None:
    block = slide_grounding_user_block("--- Web search results ---\n[W1] x")
    assert "Web search results (primary source)" in block
    assert "generic platform" in block.lower()


def test_ensure_outline_scripts_never_layout_only() -> None:
    slides = [{"index": 2, "title": "為什麼現在需要這個平台", "layout": "two_column"}]
    out = _ensure_outline_scripts(
        slides,
        deck_title="DJI Pocket 4 Pro",
        topic="搜索 DJI Pocket 4P 的規格",
    )
    assert out[0].get("slide_script")
    assert out[0].get("outline_bullets")


def test_apply_outline_fields_maps_content_field() -> None:
    row = apply_outline_fields_from_llm_row(
        {
            "index": 1,
            "title": "Hero",
            "content": "Full speaker script for slide one.",
            "layout": "title_hero",
        }
    )
    assert row.get("slide_script") == "Full speaker script for slide one."
