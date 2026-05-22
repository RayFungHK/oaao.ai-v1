"""Vault RAG citation selection — general-knowledge off-topic behavior."""

from oaao_orchestrator.vault_graph_rag import (
    _PassagePick,
    _embedding_query_for_handbook_lookup,
    _picks_for_citations,
    _query_is_general_knowledge,
)
from oaao_orchestrator.slide_project.teaching_intent import text_signals_vault_grounding


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
        ),
    ]
    assert _picks_for_citations("什么是傅立葉轉換", picks, wants_gk=True) == []
    assert _picks_for_citations("什么是傅立葉轉換", picks, wants_gk=False) == picks
