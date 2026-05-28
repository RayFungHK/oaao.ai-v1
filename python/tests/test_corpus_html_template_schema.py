"""CS-1-S18 — schema-driven html_template golden fixtures."""

from __future__ import annotations

import pytest

from oaao_orchestrator.corpus.extraction import run_two_stage_extraction
from oaao_orchestrator.corpus.html_template import build_html_template_v1, render_html_document
from oaao_orchestrator.corpus.html_template_schema import (
    build_html_template_from_extraction,
    extraction_template_golden_fixtures,
)


@pytest.mark.asyncio
async def test_golden_fixtures_three_layouts():
    fixtures = extraction_template_golden_fixtures()
    for name, fx in fixtures.items():
        tpl = build_html_template_from_extraction(
            document_type=fx["document_type"],
            extraction=fx["extraction"],
            profile_name=name,
        )
        assert tpl is not None, name
        assert tpl.get("template_source") == "extraction"
        html = render_html_document(tpl, {})
        assert "oaao-corpus-page" in html
        assert "{{" not in html or "file_ref" not in html


@pytest.mark.asyncio
async def test_build_html_template_v1_prefers_extraction():
    md = (
        "本函檔號：MEN-99\n行員申請轉讓會籍\n"
        "018 甲 (CM)\n乙 (CM)\n"
        "019 丙 (SM)\n丁 (SM)\n"
    )
    extraction = await run_two_stage_extraction(
        markdown=md,
        document_type="hk_member_notice_transfer",
        llm_cfg=None,
    )
    tpl = build_html_template_v1(
        segments=[],
        document_type="hk_member_notice_transfer",
        extraction=extraction.extraction,
        profile_name="Notice",
    )
    assert tpl.get("template_source") == "extraction"
    assert tpl.get("layout_type") == "table"
    assert tpl.get("notice_header", {}).get("defaults", {}).get("file_ref") == "MEN-99"
    html = render_html_document(tpl, {})
    assert "MEN-99" in html


@pytest.mark.asyncio
async def test_prose_extraction_template_sections():
    fx = extraction_template_golden_fixtures()["general_prose"]
    tpl = build_html_template_from_extraction(
        document_type=fx["document_type"],
        extraction=fx["extraction"],
    )
    assert tpl.get("layout_type") == "prose"
    assert len(tpl.get("parameters") or []) >= 2
