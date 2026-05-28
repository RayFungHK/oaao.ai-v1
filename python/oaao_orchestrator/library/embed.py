"""CS-2-S7 — embed library document blocks into tenant Qdrant collection."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.library.blocks import blocks_to_markdown, chunk_markdown
from oaao_orchestrator.library.qdrant import (
    default_qdrant_url,
    delete_document_points,
    ensure_collection,
    library_collection_name,
    resolve_embedding_cfg,
    resolve_qdrant_api_key,
    upsert_chunks,
)
from oaao_orchestrator.vault_rag.embed import (
    _env,
    ensure_url_scheme,
    openai_compat_embeddings_url_from_base,
    openai_compat_embed_batch,
)

logger = logging.getLogger(__name__)


async def run_library_embed(payload: dict[str, Any]) -> dict[str, Any]:
    tenant_id = int(payload.get("tenant_id") or 0)
    document_id = int(payload.get("document_id") or 0)
    if tenant_id < 1 or document_id < 1:
        return {"ok": False, "error": "tenant_id_and_document_id_required"}

    blocks = payload.get("blocks")
    if not isinstance(blocks, list):
        return {"ok": False, "error": "blocks_required"}

    title = str(payload.get("title") or "").strip()
    revision_id_raw = payload.get("revision_id")
    revision_id: int | None = None
    if revision_id_raw is not None:
        try:
            revision_id = int(revision_id_raw)
        except (TypeError, ValueError):
            revision_id = None

    markdown = str(payload.get("markdown") or "").strip()
    if not markdown:
        markdown = blocks_to_markdown(blocks, title=title)

    chunk_size = max(400, min(8000, int(payload.get("chunk_size") or _env("OAAO_LIBRARY_CHUNK_SIZE", "1800") or "1800")))
    overlap = max(0, min(chunk_size // 2, int(payload.get("chunk_overlap") or _env("OAAO_LIBRARY_CHUNK_OVERLAP", "200") or "200")))
    chunks = chunk_markdown(markdown, chunk_size=chunk_size, overlap=overlap)
    if not chunks:
        return {"ok": False, "error": "no_embeddable_text"}

    emb_base, emb_model, emb_key = resolve_embedding_cfg(payload)
    if not emb_base:
        return {"ok": False, "error": "embedding_not_configured"}

    embed_url = openai_compat_embeddings_url_from_base(emb_base)
    q_url = str(
        (payload.get("qdrant") or {}).get("url")
        if isinstance(payload.get("qdrant"), dict)
        else ""
    ).strip() or default_qdrant_url()
    q_key = resolve_qdrant_api_key(payload)
    collection = library_collection_name(tenant_id)

    async with httpx.AsyncClient() as client:
        vecs, err = await openai_compat_embed_batch(
            client,
            chunks,
            emb_key,
            url=ensure_url_scheme(embed_url),
            model=emb_model,
        )
        if not vecs or len(vecs) != len(chunks):
            return {"ok": False, "error": err or "embedding_failed", "chunk_count": len(chunks)}

        dim = len(vecs[0]) if vecs else 0
        if dim < 1:
            return {"ok": False, "error": "embedding_empty_vector"}

        if not await ensure_collection(
            client,
            base_url=q_url,
            collection=collection,
            vector_size=dim,
            api_key=q_key,
        ):
            return {"ok": False, "error": "qdrant_collection_create_failed"}

        await delete_document_points(
            client,
            base_url=q_url,
            collection=collection,
            api_key=q_key,
            tenant_id=tenant_id,
            document_id=document_id,
        )

        rows = [(i, vec, text) for i, (vec, text) in enumerate(zip(vecs, chunks))]  # noqa: B905
        ok = await upsert_chunks(
            client,
            base_url=q_url,
            collection=collection,
            api_key=q_key,
            tenant_id=tenant_id,
            document_id=document_id,
            revision_id=revision_id,
            title=title,
            chunk_rows=rows,
        )
        if not ok:
            return {"ok": False, "error": "qdrant_upsert_failed"}

    return {
        "ok": True,
        "tenant_id": tenant_id,
        "document_id": document_id,
        "revision_id": revision_id,
        "collection": collection,
        "chunk_count": len(chunks),
        "vector_dim": dim,
        "status": "embedded",
    }
