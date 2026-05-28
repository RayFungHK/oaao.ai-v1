"""Corpus segment_kind + Razy-like block tree."""

from __future__ import annotations

from oaao_orchestrator.corpus.segmenting import (
    SEGMENT_KIND_DOCUMENT,
    SEGMENT_KIND_STRUCTURED,
    SEGMENT_KIND_TEMPLATE,
    segment_analyze_text,
    segment_kind_summary,
)

HK_REGISTRY_SNIPPET = (
    "Kowloon. 電 話：28930266 傳 真：23890390 更改後資料： "
    "行員名稱 ：萬祥實業有限公司 Million Goods Enterprise Limited "
    "執行司理人：鄭展明先生 Mr. Cheng, Chin Ming "
    "註冊地址 ：九龍觀塘鴻圖道 32 號德華中心 2605 室 "
    "Flat 2605, De Hua Tower, 32 Hung To Road, Kwun Tong, Kowloon."
)

MEMBER_MULTI = (
    "本函檔號：MEN-001\n"
    "【第 100 號行員】：\n"
    "行員名稱：富格林有限公司 WB Corporation Limited\n"
    "註冊地址：九龍荔枝角大南西街 1018 號\n"
    "【第 101 號行員】：\n"
    "行員名稱：另一有限公司 Another Limited\n"
    "註冊地址：香港中環\n"
)

TABLE_ROWS = (
    "編號 更改行員名稱前行員名稱及執行司理人 更改行員名稱後行員名稱及執行司理人 公佈日期\n"
    "017 mGold Financial Services Limited\n廖崇業先生\nMr. Liu, Sung Yip Kenny\n"
    "GoldRock Financial Services Limited\n廖崇業先生\nMr. Liu, Sung Yip Kenny\n"
    "20-3-2026\n"
    "018 Foo Bar Limited\nJane Doe\nMr. Jane Doe\n"
    "Baz Qux Limited\nJane Doe\nMr. Jane Doe\n"
    "21-3-2026\n"
)


def test_structured_hk_registry_block_becomes_one_segment():
    segments = segment_analyze_text(HK_REGISTRY_SNIPPET)
    structured = [s for s in segments if s[1].get("segment_kind") == SEGMENT_KIND_STRUCTURED]
    assert len(structured) == 1
    text, meta = structured[0]
    fields = meta.get("fields")
    assert isinstance(fields, list) and len(fields) >= 4
    assert "行員名稱" in text or "行員名稱" in {f["label"] for f in fields if isinstance(f, dict)}


def test_plain_prose_is_document_segment():
    segments = segment_analyze_text("This is a normal paragraph.\n\nAnother one here.")
    assert len(segments) >= 1
    for _text, meta in segments:
        assert meta.get("segment_kind") == SEGMENT_KIND_DOCUMENT


def test_member_records_split_into_template_blocks():
    segments = segment_analyze_text(MEMBER_MULTI)
    blocks = [s for s in segments if s[1].get("segment_kind") == SEGMENT_KIND_TEMPLATE]
    assert len(blocks) >= 2
    ids = []
    for _t, m in blocks:
        blk = m.get("block")
        assert isinstance(blk, dict)
        assert blk.get("name") == "member_record"
        ids.append(str(blk.get("id")))
    assert "100" in ids and "101" in ids


def test_table_rows_split_into_blocks():
    segments = segment_analyze_text(TABLE_ROWS)
    rows = [
        s
        for s in segments
        if s[1].get("segment_kind") == SEGMENT_KIND_TEMPLATE
        and isinstance(s[1].get("block"), dict)
        and s[1]["block"].get("name") == "table_row"
    ]
    assert len(rows) >= 2
    row_ids = {str(s[1]["block"].get("id")) for s in rows}
    assert "017" in row_ids and "018" in row_ids


def test_segment_kind_summary_counts():
    segments = segment_analyze_text(MEMBER_MULTI)
    payload = [{"classify_json": m} for _t, m in segments]
    summary = segment_kind_summary(payload)
    assert summary[SEGMENT_KIND_TEMPLATE] >= 2
