"""Structure blueprint, source outlier scoring, and post-generate similarity."""

from __future__ import annotations

from oaao_orchestrator.corpus.structure import (
    build_structure_blueprint,
    compare_generate_to_corpus,
    fingerprint_from_segments,
    fingerprint_similarity,
    score_sources_vs_corpus,
)


def _seg(text: str, kind: str, **extra) -> dict:
    cj: dict = {"segment_kind": kind, **extra}
    return {"text": text, "ordinal": 0, "classify_json": cj}


def test_fingerprint_similarity_identical_kinds():
    segs = [
        _seg("甲：1", "structured_data", fields=[{"label": "甲", "value": "1"}]),
        _seg("乙：2", "structured_data", fields=[{"label": "乙", "value": "2"}]),
    ]
    a = fingerprint_from_segments(segs)
    b = fingerprint_from_segments(segs)
    assert fingerprint_similarity(a, b) == 1.0


def test_score_sources_flags_outlier():
    corpus = [
        _seg("Name：Ray", "structured_data", fields=[{"label": "Name", "value": "Ray"}]),
        _seg("Role：Lead", "structured_data", fields=[{"label": "Role", "value": "Lead"}]),
        _seg("【第 1 號行員】\nFoo：bar", "template_block", block={"name": "member_record"}),
    ]
    corpus_fp = fingerprint_from_segments(corpus)
    good = {
        "source_id": 1,
        "label": "good.pdf",
        "fingerprint": fingerprint_from_segments(corpus[:2]),
        "segment_count": 2,
    }
    bad = {
        "source_id": 2,
        "label": "essay.txt",
        "fingerprint": fingerprint_from_segments(
            [_seg("Once upon a time in a land far away there was prose only.", "document_segment")]
        ),
        "segment_count": 1,
    }
    scored = score_sources_vs_corpus([good, bad], corpus_fp)
    by_id = {r["source_id"]: r for r in scored}
    assert by_id[1]["outlier"] is False
    assert by_id[2]["outlier"] is False  # need >=3 sources to flag


def test_score_sources_peer_cluster_one_mismatch():
    """Four similar staff notices + one different — only the different file is an outlier."""
    staff_segs = [
        _seg("日期：2026-01-01", "structured_data", fields=[{"label": "日期", "value": "x"}]),
        _seg("主旨：通告", "structured_data", fields=[{"label": "主旨", "value": "y"}]),
        _seg("【第 1 號行員】\n姓名：甲", "template_block", block={"name": "member_record"}),
    ]
    member_segs = [
        _seg("長篇敘述只有段落沒有表格欄位。", "document_segment"),
        _seg("另一段 prose without labels.", "document_segment"),
        _seg("第三段。", "document_segment"),
    ]
    staff_fp = fingerprint_from_segments(staff_segs)
    member_fp = fingerprint_from_segments(member_segs)
    rows = [
        {
            "source_id": i,
            "label": f"staff-{i}.pdf",
            "fingerprint": staff_fp,
            "segment_count": len(staff_segs),
        }
        for i in range(1, 5)
    ]
    rows.append(
        {
            "source_id": 5,
            "label": "member.pdf",
            "fingerprint": member_fp,
            "segment_count": len(member_segs),
        }
    )
    scored = score_sources_vs_corpus(rows, fingerprint_from_segments(staff_segs * 4 + member_segs))
    outliers = [r for r in scored if r.get("outlier")]
    assert len(outliers) == 1
    assert outliers[0]["source_id"] == 5
    by_id = {r["source_id"]: r for r in scored}
    for i in range(1, 5):
        assert (by_id[i].get("similarity") or 0) >= 0.45


def test_fingerprint_similarity_ignores_segment_counts():
    few = fingerprint_from_segments([_seg("甲：1", "structured_data", fields=[{"label": "甲", "value": "1"}])])
    many = fingerprint_from_segments(
        [_seg(f"欄{i}：v", "structured_data", fields=[{"label": f"欄{i}", "value": "v"}]) for i in range(12)]
    )
    assert fingerprint_similarity(few, many) >= 0.5


def test_build_structure_blueprint_preserves_order():
    segs = [
        {**_seg("A", "document_segment"), "ordinal": 0},
        {**_seg("【第 1 號行員】", "template_block", block={"name": "member_record"}), "ordinal": 1},
    ]
    bp = build_structure_blueprint(segs)
    layout = bp.get("layout") or []
    assert len(layout) >= 2
    assert layout[0]["segment_kind"] == "document_segment"
    assert layout[1]["segment_kind"] == "template_block"


def test_compare_generate_high_when_aligned():
    segs = [
        _seg("【第 1 號行員】\n姓名：甲", "template_block", block={"name": "member_record"}),
        _seg("職位：司理", "structured_data", fields=[{"label": "職位", "value": "司理"}]),
    ]
    bp = build_structure_blueprint(segs)
    md = "【第 1 號行員】\n姓名：乙\n職位：副理"
    sim = compare_generate_to_corpus(md, segs, blueprint=bp)
    assert sim["score"] >= 0.55
    assert sim["meets_target"] is True
