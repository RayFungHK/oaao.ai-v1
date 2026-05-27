"""Vault job claim backpressure — embed/ASR must not be starved by graph backlog."""

from __future__ import annotations

from oaao_orchestrator.vault_job_pg import _BACKPRESSURE_WHEN_INGEST_QUEUED, _INGEST_HOOKS


def test_ingest_hooks_include_embed_and_asr():
    assert "vh.rag.document_embed" in _INGEST_HOOKS
    assert "vh.rag.audio_asr" in _INGEST_HOOKS


def test_backpressure_sql_defers_graph_when_ingest_queued():
    sql = _BACKPRESSURE_WHEN_INGEST_QUEUED
    assert "vh.rag.document_embed" in sql
    assert "vh.rag.audio_asr" in sql
    assert "NOT EXISTS" in sql
    assert "j2.status = 'queued'" in sql
