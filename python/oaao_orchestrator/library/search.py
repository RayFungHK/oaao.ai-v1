"""CS-2-S7 — vector search within tenant library collection (attach-scoped)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.library.qdrant import (
    default_qdrant_url,
    library_collection_name,
    resolve_embedding_cfg,
    resolve_qdrant_api_key,
    search_points,
)
from oaao_orchestrator.vault_rag.embed import (
    ensure_url_scheme,
    openai_compat_embeddings_url_from_base,
    openai_compat_embed_batch,
)

logger = logging.getLogger(__name__)


async def run_library_search(payload: dict[str, Any]) -> dict[str, Any]:
    tenant_id = int(payload.get("tenant_id") or 0)
    query = str(payload.get("query") or "").strip()
    if tenant_id < 1:
        return {"ok": False, "error": "tenant_id_required"}
    if not query:
        return {"ok": False, "error": "query_required"}

    doc_ids_raw = payload.get("document_ids")
    document_ids: list[int] | None = None
    if isinstance(doc_ids_raw, list) and doc_ids_raw:
        document_ids = sorted({int(x) for x in doc_ids_raw if int(x) > 0})
        if not document_ids:
            document_ids = None

    limit = int(payload.get("limit") or 6)
    limit = max(1, min(24, limit))
    min_score = float(payload.get("min_score") or 0.35)
    min_score = max(0.0, min(1.0, min_score))

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
            [query[:4000]],
            emb_key,
            url=ensure_url_scheme(embed_url),
            model=emb_model,
        )
        if not vecs or not vecs[0]:
            return {"ok": False, "error": err or "query_embedding_failed"}

        hits = await search_points(
            client,
            base_url=q_url,
            collection=collection,
            api_key=q_key,
            tenant_id=tenant_id,
            vector=vecs[0],
            document_ids=document_ids,
            limit=limit,
        )

    results: list[dict[str, Any]] = []
    for hit in hits:
        if not isinstance(hit, dict):
            continue
        score = float(hit.get("score") or 0.0)
        if score < min_score:
            continue
        pl = hit.get("payload") if isinstance(hit.get("payload"), dict) else {}
        text = str(pl.get("text") or "").strip()
        if not text:
            continue
        try:
            doc_id = int(pl.get("document_id") or 0)
        except (TypeError, ValueError):
            doc_id = 0
        results.append(
            {
                "score": round(score, 4),
                "document_id": doc_id,
                "chunk_index": pl.get("chunk_index"),
                "title": pl.get("title"),
                "text": text[:4000],
                "revision_id": pl.get("revision_id"),
            }
        )

    return {
        "ok": True,
        "tenant_id": tenant_id,
        "collection": collection,
        "query": query[:500],
        "document_ids": document_ids,
        "hits": results[:limit],
        "hit_count": len(results),
    }
