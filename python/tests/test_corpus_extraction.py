"""CS-1-S17 — two-stage corpus extraction."""

from __future__ import annotations

import pytest

from oaao_orchestrator.corpus.extraction import (
    extract_pass_a_heuristic,
    extract_pass_b,
    run_two_stage_extraction,
)


def test_pass_a_hk_transfer_heuristic():
    md = (
        "本函檔號：MEN-1\n"
        "2024 年 3 月 15 日\n"
        "致：各會員\n"
        "行員申請轉讓會籍\n"
        "下列為轉讓詳情：\n"
        "018 甲行員 (CM)\n乙行員 (CM)\n"
        "019 丙行員 (SM)\n丁行員 (SM)\n"
    )
    raw, blocks = extract_pass_a_heuristic(markdown=md, document_type="hk_member_notice_transfer")
    assert raw.get("notice_header", {}).get("file_ref") == "MEN-1"
    assert len(raw.get("table_rows") or []) >= 2
    assert any(b.kind == "table" for b in blocks)


def test_pass_b_cleans_and_dedupes_rows():
    raw = {
        "notice_header": {"intro_paragraph": "  下列   詳情  "},
        "table_rows": [
            {"id": "018", "before": " A "},
            {"id": "018", "before": "dup"},
            {"id": "019", "before": "B"},
        ],
    }
    cleaned = extract_pass_b(document_type="hk_member_notice_transfer", raw=raw)
    assert cleaned["notice_header"]["intro_paragraph"] == "下列 詳情"
    assert len(cleaned["table_rows"]) == 2
    assert cleaned["table_rows"][0]["id"] == "018"


@pytest.mark.asyncio
async def test_run_two_stage_extraction_validates():
    md = (
        "本函檔號：MEN-2\n行員申請轉讓會籍\n"
        "018 甲 (CM)\n乙 (CM)\n"
        "019 丙 (SM)\n丁 (SM)\n"
    )
    result = await run_two_stage_extraction(
        markdown=md,
        document_type="hk_member_notice_transfer",
        llm_cfg=None,
    )
    assert result.document_type == "hk_member_notice_transfer"
    assert result.extraction is not None
    assert result.extraction.get("table_rows")
    assert result.pass_b_applied is True


@pytest.mark.asyncio
async def test_run_two_stage_unknown_prose():
    md = "# Intro\n\nFirst paragraph.\n\n## Details\n\nMore text here."
    result = await run_two_stage_extraction(
        markdown=md,
        document_type="general_prose",
        llm_cfg=None,
    )
    assert result.extraction is not None
    assert result.extraction.get("sections")
