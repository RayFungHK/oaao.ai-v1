"""RAG Explore — PassagePick.score must survive passage selection."""

from __future__ import annotations

import pytest

from oaao_orchestrator.vault_rag.passages import PassagePick, select_passages_for_vault


def test_select_passages_for_vault_preserves_score() -> None:
    hit = {
        "score": 0.91,
        "payload": {
            "vault_id": 1,
            "document_id": 42,
            "file_name": "handbook.pdf",
            "text": "Capital requirements for licensed corporations.",
            "segment_type": "document_chunk",
            "chunk_index": 3,
        },
    }
    ranked = [(0.88, hit)]
    picks, _below = select_passages_for_vault(
        ranked,
        vault_id=1,
        per_vault_limit=4,
        min_score=0.1,
        seen=set(),
    )
    assert len(picks) == 1
    assert isinstance(picks[0], PassagePick)
    assert picks[0].score == pytest.approx(0.88)


@pytest.mark.asyncio
async def test_explore_vault_rag_passage_score_roundtrip(monkeypatch: pytest.MonkeyPatch) -> None:
    from oaao_orchestrator import vault_rag_explore as mod

    pick = PassagePick(
        passage="doc 42 — Capital requirements for licensed corporations.",
        vault_id=1,
        document_id=42,
        file_name="handbook.pdf",
        segment_type="document_chunk",
        score=0.77,
    )

    async def fake_embed(*_a, **_k):
        return [0.1, 0.2], None

    async def fake_qdrant(**_k):
        return [{"score": 0.77, "payload": {"document_id": 42, "text": "Capital requirements"}}]

    monkeypatch.setattr(mod, "_openai_embed", fake_embed)
    monkeypatch.setattr(mod, "_qdrant_search", fake_qdrant)
    monkeypatch.setattr(mod, "_select_passages_for_vault", lambda *_a, **_k: ([pick], 0))

    data = await mod.explore_vault_rag(
        query="capital requirements",
        vault_retrieval_profiles=[
            {
                "vault_id": 1,
                "vault_name": "HKGX",
                "qdrant_collection": "localhost_personal_u_2",
            }
        ],
        embedding={"model": "test-embed", "base_url": "http://embed/v1"},
    )
    assert data["passages"]
    assert data["passages"][0]["score"] == pytest.approx(0.77)
