"""CS-1-S12/S13 — html template build + render skeleton."""

from __future__ import annotations

import pytest

from oaao_orchestrator.corpus.html_template import (
    build_html_template_v1,
    render_html_document,
    render_pdf_from_html,
)
from oaao_orchestrator.corpus.render_worker import run_corpus_render, run_corpus_template_build


def _seg(text: str, kind: str, **cj_extra) -> dict:
    cj: dict = {"segment_kind": kind, **cj_extra}
    return {"text": text, "ordinal": 0, "classify_json": cj}


@pytest.mark.asyncio
async def test_template_build_from_template_block_fields():
    segments = [
        _seg(
            "【第 1 號行員】",
            "template_block",
            block={"name": "member_record", "id": "1"},
            fields=[
                {"label": "姓名", "value": "甲"},
                {"label": "部門", "value": "營運"},
            ],
        ),
    ]
    out = await run_corpus_template_build({"segments": segments, "profile_name": "通告"})
    assert out.get("ok") is True
    tpl = out.get("html_template")
    assert isinstance(tpl, dict)
    params = tpl.get("parameters")
    assert isinstance(params, list) and len(params) >= 2
    keys = {p["key"] for p in params}
    assert "body" not in keys or len(params) > 2


@pytest.mark.asyncio
async def test_render_html_fills_parameters():
    segments = [
        _seg(
            "x",
            "template_block",
            fields=[{"label": "姓名", "value": "範例"}],
            block={"name": "member_record"},
        ),
    ]
    tpl = build_html_template_v1(segments=segments)
    param_key = tpl["parameters"][0]["key"]
    result = await run_corpus_render(
        {
            "format": "html",
            "html_template": tpl,
            "parameters": {param_key: "王小明"},
            "background": False,
        }
    )
    assert result.get("ok") is True
    html = result.get("html") or ""
    assert "王小明" in html
    assert "{{" not in html or param_key not in html


@pytest.mark.asyncio
async def test_render_pdf_returns_html_and_optional_pdf(monkeypatch):
    tpl = build_html_template_v1(segments=[_seg("hello", "document_segment")])

    def _fake_pdf(html: str):
        return b"%PDF-1.4 fake", None

    monkeypatch.setattr(
        "oaao_orchestrator.corpus.pdf_render.html_to_pdf_bytes",
        lambda h: _fake_pdf(h),
    )
    result = await run_corpus_render(
        {"format": "pdf", "html_template": tpl, "parameters": {}, "background": False}
    )
    assert result.get("ok") is True
    assert result.get("pdf_bytes_b64")
    assert isinstance(result.get("html"), str) and len(result["html"]) > 50


def test_render_html_document_escapes_values():
    tpl = build_html_template_v1(
        segments=[
            _seg("a", "template_block", fields=[{"label": "備註", "value": "x"}], block={"name": "r"}),
        ],
    )
    key = tpl["parameters"][0]["key"]
    doc = render_html_document(tpl, {key: "<script>"})
    assert "<script>" not in doc
    assert "&lt;script&gt;" in doc


@pytest.mark.asyncio
async def test_template_dedupes_repeated_member_record_fields():
    fields = [
        {"label": "電話", "value": "1"},
        {"label": "行員名稱", "value": "甲"},
        {"label": "執行司理人", "value": "乙"},
    ]
    segments = [
        _seg("【第 1 號】", "template_block", block={"name": "member_record", "id": "1"}, fields=fields),
        _seg("【第 2 號】", "template_block", block={"name": "member_record", "id": "2"}, fields=fields),
        _seg("【第 3 號】", "template_block", block={"name": "member_record", "id": "3"}, fields=fields),
    ]
    tpl = build_html_template_v1(segments=segments)
    labels = [p["label"] for p in tpl["parameters"]]
    assert labels.count("電話") == 1
    assert labels.count("行員名稱") == 1
    assert tpl.get("collapsed_duplicate_blocks", 0) >= 2
    assert tpl["html_body"].count("oaao-corpus-block") == 1


def test_table_segments_include_preamble_letterhead():
    text = (
        "本函檔號：MEN-2601003\n"
        "2026 年 1 月 23 日\n"
        "致：行員寶號執行司理先生／女士\n"
        "行員申請轉讓會籍\n"
        "下列行員來函申請轉讓會籍，依章公佈行員 10 天。\n"
        "編號 轉讓前行員 轉讓後行員 介紹人 公佈日期\n"
        "018 陳志強 (CM)\n李嘉誠 (CM)\n黃美玲\n2023-10-25\n"
        "019 張小明 (SM)\n林婉婷 (SM)\n周大文\n2023-11-02\n"
    )
    from oaao_orchestrator.corpus.segmenting import segment_analyze_text

    segments = [
        {"text": t, "ordinal": i, "classify_json": m}
        for i, (t, m) in enumerate(segment_analyze_text(text))
    ]
    kinds = [s["classify_json"].get("segment_kind") for s in segments]
    assert "document_segment" in kinds
    tpl = build_html_template_v1(segments=segments, profile_name="Notice")
    assert tpl.get("layout_type") == "table"
    nh = tpl.get("notice_header") or {}
    defaults = nh.get("defaults") if isinstance(nh, dict) else {}
    assert defaults.get("file_ref") == "MEN-2601003"
    assert "2026" in str(defaults.get("notice_date") or "")
    html = render_html_document(tpl, {})
    assert "MEN-2601003" in html
    assert "行員申請轉讓會籍" in html
    assert "下列行員" in html


def test_table_layout_template_from_table_row_segments():
    text = (
        "編號 轉讓前行員 轉讓後行員 介紹人 公佈日期\n"
        "017 Before Co\nMr. A\nAfter Co\nMr. B\n張三, 李四\n23-1-2026\n"
        "044 Before2\nMr. C\nAfter2\nMr. D\n王五, 趙六\n24-1-2026\n"
    )
    from oaao_orchestrator.corpus.segmenting import segment_analyze_text

    segments = [
        {"text": t, "ordinal": i, "classify_json": m}
        for i, (t, m) in enumerate(segment_analyze_text(text))
    ]
    tpl = build_html_template_v1(segments=segments, profile_name="Notice")
    assert tpl.get("layout_type") == "table"
    assert len(tpl.get("sample_rows") or []) >= 2
    assert "oaao-corpus-table" in tpl.get("html_body", "")


def test_render_pdf_from_html_not_configured():
    out = render_pdf_from_html("<html></html>")
    assert out.get("ok") is False
