"""CS-1-S7 — corpus style merge + context block."""

from __future__ import annotations

from oaao_orchestrator.corpus.llm import (
    build_generate_context,
    infer_generate_output_mode,
    merge_style_json,
)
from oaao_orchestrator.corpus.style_context import build_corpus_style_system_block


def test_merge_style_json_prefers_llm_tone():
    heuristic = {
        "version": 1,
        "structure": {"heading_style": "markdown_headings"},
        "lexicon": {"preferred_terms": [], "avoid_terms": []},
        "formatting": {"list_style": "bullet", "citation_style": ""},
        "tone": "neutral",
        "dos": ["Keep rhythm"],
        "donts": [],
        "meta": {"segment_count": 2, "style_source": "heuristic"},
    }
    llm = {
        "version": 1,
        "tone": "formal",
        "dos": ["Use numbered lists for procedures"],
        "meta": {"style_confidence": 0.88, "style_source": "llm"},
    }
    out = merge_style_json(heuristic, llm, segment_count=5)
    assert out["tone"] == "formal"
    assert "numbered" in out["dos"][0]
    assert out["meta"]["style_confidence"] == 0.88


def test_infer_narrative_mode_for_notice_brief():
    assert infer_generate_output_mode("一封 2-3 段的公司通知，說明測試數據上線，語氣正式") == "narrative"


def test_narrative_digest_forbids_registry_layout():
    ctx = build_generate_context(
        [
            {
                "text": "【第 512 號行員】\n行員名稱：Foo",
                "classify_json": {
                    "segment_kind": "template_block",
                    "block": {"name": "member_record", "id": "512"},
                },
            },
        ],
        output_mode="narrative",
    )
    assert "【第 512" not in ctx
    assert "FORBIDDEN" in ctx
    assert "行員名稱" in ctx


def test_build_generate_context_avoids_pasting_member_blocks():
    segments = [
        {
            "text": "【第 512 號行員】\n行員名稱：Foo Ltd\n註冊地址：HK",
            "classify_json": {
                "segment_kind": "template_block",
                "block": {"name": "member_record", "id": "512"},
            },
        },
        {
            "text": "本處於2026年6月15日舉行會議，討論更改註冊地址事宜。",
            "classify_json": {"segment_kind": "document_segment"},
        },
    ]
    ctx = build_generate_context(segments, output_mode="structured")
    assert "【第 512 號行員】" not in ctx
    assert "member_record" in ctx


def test_corpus_style_system_block_ready_only():
    block = build_corpus_style_system_block(
        {
            "name": "Brand",
            "status": "ready",
            "style_json": {"version": 1, "tone": "formal"},
        },
    )
    assert block is not None
    assert "Corpus writing style" in block
    assert build_corpus_style_system_block({"name": "X", "status": "draft", "style_json": {}}) is None
