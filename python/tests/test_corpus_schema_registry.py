"""CS-1-S16 — document_type + schema registry."""

from __future__ import annotations

import pytest

from oaao_orchestrator.corpus.schema_registry import (
    classify_document_heuristic,
    load_schema_registry,
    validate_extraction,
)


def test_registry_loads_types():
    reg = load_schema_registry()
    ids = {t.id for t in reg.types}
    assert "hk_member_notice_transfer" in ids
    assert "unknown" in ids


def test_heuristic_classifies_transfer_notice():
    md = (
        "本函檔號：MEN-1\n行員申請轉讓會籍\n編號 轉讓前行員 轉讓後行員\n"
        "018 甲 (CM)\n乙 (CM)\n"
        "019 丙 (SM)\n丁 (SM)\n"
    )
    result = classify_document_heuristic(md)
    assert result.document_type == "hk_member_notice_transfer"
    assert result.layout_hint == "table_notice"


def test_validate_hk_transfer_extract():
    payload = {
        "notice_header": {"file_ref": "MEN-1", "notice_title": "行員申請轉讓會籍"},
        "table_rows": [{"id": "018", "before": "A", "after": "B"}],
    }
    validated, errors = validate_extraction("hk_member_notice_transfer", payload)
    assert not errors
    assert validated is not None
    assert validated["table_rows"][0]["id"] == "018"


def test_validate_rejects_bad_row():
    payload = {"table_rows": [{}]}
    _, errors = validate_extraction("hk_member_notice_transfer", payload)
    assert errors


@pytest.mark.asyncio
async def test_classify_document_no_llm():
    from oaao_orchestrator.corpus.schema_registry import classify_document

    md = "【第 1 號行員】\n【第 2 號行員】\n行員名稱：A"
    result = await classify_document(markdown=md, llm_cfg=None)
    assert result.document_type == "hk_member_registry_blocks"
