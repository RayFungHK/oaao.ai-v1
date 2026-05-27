"""Vault ingest SSE + status snapshot tests (#9 phase 2)."""

from __future__ import annotations

from oaao_orchestrator.routes.vault import _ingest_subject, _vault_ingest_tokens
from oaao_orchestrator.vault_ingest_status import _aggregate_counts, _row_to_doc


def test_ingest_subject_stable():
    assert _ingest_subject(42, 7) == "vault_ingest:42:7"


def test_vault_ingest_stream_token_mint_validate():
    subject = _ingest_subject(1, 99)
    token = _vault_ingest_tokens.mint(subject)
    assert _vault_ingest_tokens.validate(subject, token)
    assert not _vault_ingest_tokens.validate(subject, token + "ff")


def test_row_to_doc_shape():
    doc = _row_to_doc(
        {
            "id": 5,
            "vault_id": 2,
            "container_id": None,
            "file_name": "a.mp3",
            "embed_status": "embedded",
            "embed_error": None,
            "embed_attempts": 1,
            "graph_status": "failed",
            "graph_error": "no_extractable_text_for_graph",
            "byte_size": 1024,
            "has_transcript": 0,
        }
    )
    assert doc["id"] == 5
    assert doc["graph_status"] == "failed"
    assert doc["graph_error"] == "no_extractable_text_for_graph"


def test_aggregate_counts():
    counts = _aggregate_counts(
        [
            {"embed_status": "embedded", "graph_status": "failed"},
            {"embed_status": "embedding", "graph_status": "building"},
        ]
    )
    assert counts["embed_embedded"] == 1
    assert counts["embed_embedding"] == 1
    assert counts["graph_failed"] == 1
    assert counts["graph_building"] == 1
    assert counts["total"] == 2
