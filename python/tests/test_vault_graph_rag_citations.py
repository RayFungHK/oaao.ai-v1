"""Vault RAG citation selection — general-knowledge off-topic behavior."""

from oaao_orchestrator.slide_project.teaching_intent import text_signals_vault_grounding
from oaao_orchestrator.vault_graph_rag import (
    VaultRagOutcome,
    _citation_from_pick,
    _embedding_query_for_handbook_lookup,
    _format_numbered_passage_block,
    _PassagePick,
    _picks_for_citations,
    _query_is_general_knowledge,
    build_pipeline_snapshot_for_rag,
)


def test_query_is_general_knowledge_fourier() -> None:
    assert _query_is_general_knowledge("什么是傅立葉轉換") is True
    assert _query_is_general_knowledge("what is Fourier transform") is True


def test_handbook_vol_query_signals_grounding() -> None:
    q = "Regulatory Handbook 中的 Vol.3 是在說什麼?"
    assert text_signals_vault_grounding(q) is True
    assert _query_is_general_knowledge(q) is False
    boosted = _embedding_query_for_handbook_lookup(q)
    assert "Volume 3" in boosted or "Vol.3" in boosted


def test_picks_for_citations_skips_gk_fallback() -> None:
    picks = [
        _PassagePick(
            passage="meeting about currency wallet installation",
            vault_id=1,
            document_id=10,
            file_name="meeting.mp3",
            segment_type=None,
        ),
    ]
    assert _picks_for_citations("什么是傅立葉轉換", picks, wants_gk=True) == []
    assert _picks_for_citations("什么是傅立葉轉換", picks, wants_gk=False) == picks


def test_numbered_passage_and_citation_index() -> None:
    pick = _PassagePick(
        passage="[vault 1, doc 10]\nAlpha beta content.",
        vault_id=1,
        document_id=10,
        file_name="handbook.pdf",
        segment_type="text",
        excerpt="Alpha beta content.",
    )
    block = _format_numbered_passage_block(1, pick, "Alpha beta content.")
    assert block.startswith("[1] handbook.pdf")
    assert "Alpha beta content." in block
    cite = _citation_from_pick(cite_index=1, pick=pick, ref_names={}, catalog_entries={})
    assert cite is not None
    assert cite.cite_index == 1
    snap = build_pipeline_snapshot_for_rag(
        VaultRagOutcome(passage_count=1, profile_hits=1, citation_refs=[cite]),
        {},
    )
    blocks = snap.get("blocks") or []
    rag = next(b for b in blocks if b.get("type") == "rag_citations")
    refs = rag.get("props", {}).get("references") or []
    assert refs[0].get("cite_index") == 1
