"""Dispatch claimed vault ingest jobs — shared by poll loop and future queue consumers."""

from __future__ import annotations

from typing import Any

import httpx

from oaao_orchestrator.vault_audio_asr import process_vault_audio_asr
from oaao_orchestrator.vault_document_embed import process_vault_document_embed
from oaao_orchestrator.vault_graph_index import process_vault_graph_index
from oaao_orchestrator.vault_transcript_summary import process_vault_transcript_summary


def stub_finish_payload(job_id: int, *, stub_mode: str) -> dict[str, Any]:
    mode = (stub_mode or "fail").strip().lower()
    if mode == "complete":
        return {"job_id": job_id, "status": "completed"}
    return {"job_id": job_id, "status": "failed", "error": "orchestrator_stub_no_processing"}


async def build_vault_job_finish_body(
    client: httpx.AsyncClient,
    job: dict[str, Any],
    *,
    stub_mode: str = "fail",
) -> dict[str, Any]:
    """Run hook handler and return JSON body for ``vault_job_finish``."""
    jid_raw = job.get("job_id")
    jid = int(jid_raw) if jid_raw is not None else 0
    hook = str(job.get("hook_id") or "")

    if hook == "vh.rag.document_embed":
        st, ferr, extras = await process_vault_document_embed(client, job)
        finish_body: dict[str, Any] = {"job_id": jid, "status": st, **extras}
        if st != "completed":
            finish_body["error"] = (ferr or "document_embed_failed")[:4000]
        return finish_body
    if hook == "vh.rag.graph_index":
        st, ferr, extras = await process_vault_graph_index(client, job)
        finish_body = {"job_id": jid, "status": st, **extras}
        if st != "completed":
            finish_body["error"] = (ferr or "graph_index_failed")[:4000]
        return finish_body
    if hook == "vh.rag.audio_asr":
        st, ferr, extras = await process_vault_audio_asr(client, job)
        finish_body = {"job_id": jid, "status": st, **extras}
        if st != "completed":
            finish_body["error"] = (ferr or "audio_asr_failed")[:4000]
        return finish_body
    if hook == "vh.rag.transcript_summary":
        st, ferr, extras = await process_vault_transcript_summary(client, job)
        finish_body = {"job_id": jid, "status": st, **extras}
        if st != "completed":
            finish_body["error"] = (ferr or "transcript_summary_failed")[:4000]
        return finish_body
    return stub_finish_payload(jid, stub_mode=stub_mode)
