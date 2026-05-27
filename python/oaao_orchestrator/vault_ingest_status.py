"""Vault ingest status snapshots for browser SSE (Top-20 #9 phase 2)."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.db.pg import pg_connection, pool_available

logger = logging.getLogger(__name__)

_TRANSIENT_SQL = """
SELECT id,
       vault_id,
       container_id,
       file_name,
       embed_status,
       embed_error,
       embed_attempts,
       graph_status,
       graph_error,
       byte_size,
       (CASE WHEN source_text IS NOT NULL AND BTRIM(source_text) <> '' THEN 1 ELSE 0 END) AS has_transcript
  FROM oaao_vault_document
 WHERE vault_id = %s
   AND (
        embed_status = ANY(%s)
        OR graph_status = ANY(%s)
        OR (array_length(%s::int[], 1) IS NOT NULL AND id = ANY(%s))
   )
 ORDER BY id ASC
"""

_ALL_SQL = """
SELECT id,
       vault_id,
       container_id,
       file_name,
       embed_status,
       embed_error,
       embed_attempts,
       graph_status,
       graph_error,
       byte_size,
       (CASE WHEN source_text IS NOT NULL AND BTRIM(source_text) <> '' THEN 1 ELSE 0 END) AS has_transcript
  FROM oaao_vault_document
 WHERE vault_id = %s
 ORDER BY id ASC
"""


def _row_to_doc(row: dict[str, Any]) -> dict[str, Any]:
    graph_status = str(row.get("graph_status") or "").strip()
    embed_error = row.get("embed_error")
    graph_error = row.get("graph_error")
    return {
        "id": int(row.get("id") or 0),
        "vault_id": int(row.get("vault_id") or 0),
        "container_id": int(row["container_id"]) if row.get("container_id") is not None else None,
        "file_name": str(row.get("file_name") or ""),
        "embed_status": str(row.get("embed_status") or ""),
        "embed_error": str(embed_error).strip() if isinstance(embed_error, str) and embed_error.strip() else None,
        "embed_attempts": int(row.get("embed_attempts") or 0),
        "graph_status": graph_status or None,
        "graph_error": str(graph_error).strip() if isinstance(graph_error, str) and graph_error.strip() else None,
        "byte_size": int(row["byte_size"]) if row.get("byte_size") is not None else None,
        "has_transcript": bool(row.get("has_transcript")),
    }


def _aggregate_counts(documents: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {
        "embed_pending": 0,
        "embed_embedding": 0,
        "embed_embedded": 0,
        "embed_failed": 0,
        "embed_held": 0,
        "graph_pending": 0,
        "graph_building": 0,
        "graph_indexed": 0,
        "graph_failed": 0,
        "total": 0,
    }
    for doc in documents:
        counts["total"] += 1
        ek = f"embed_{doc.get('embed_status') or ''}"
        if ek in counts:
            counts[ek] += 1
        gs = doc.get("graph_status")
        if isinstance(gs, str) and gs:
            gk = f"graph_{gs}"
            if gk in counts:
                counts[gk] += 1
    return counts


def fetch_vault_ingest_status(
    vault_id: int,
    *,
    transient_only: bool = True,
    document_ids: set[int] | None = None,
) -> dict[str, Any] | None:
    """Return vault_status-shaped payload or None when PG unavailable."""
    if vault_id < 1 or not pool_available():
        return None

    embed_transient = ["pending", "embedding"]
    graph_transient = ["pending", "building"]
    watch_list = sorted(document_ids) if document_ids else []

    try:
        from psycopg.rows import dict_row

        with pg_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                if transient_only:
                    cur.execute(
                        _TRANSIENT_SQL,
                        (vault_id, embed_transient, graph_transient, watch_list, watch_list),
                    )
                else:
                    cur.execute(_ALL_SQL, (vault_id,))
                rows = cur.fetchall() or []
    except Exception:  # noqa: BLE001
        logger.warning("vault_ingest_status: query failed vault_id=%s", vault_id, exc_info=True)
        return None

    documents = [_row_to_doc(dict(r)) for r in rows if isinstance(r, dict)]
    if document_ids:
        documents = [d for d in documents if d["id"] in document_ids]

    return {
        "vault_id": vault_id,
        "transient_only": transient_only,
        "counts": _aggregate_counts(documents),
        "documents": documents,
    }
