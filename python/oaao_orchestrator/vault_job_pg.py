"""Claim / reclaim vault jobs via PostgreSQL (parity with PHP vault_job_claim)."""

from __future__ import annotations

import json
import logging
from typing import Any

from oaao_orchestrator.db.pg import pg_connection, pool_available

logger = logging.getLogger(__name__)

_CLAIM_SQL = """
WITH picked AS (
    SELECT job_id FROM oaao_vault_job
    WHERE status = 'queued'
       OR (
            status = 'running'
            AND claimed_at IS NOT NULL
            AND claimed_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
       )
    {hook_filter}
    ORDER BY CASE WHEN status = 'queued' THEN 0 ELSE 1 END, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
UPDATE oaao_vault_job j
SET status = 'running',
    claimed_at = CURRENT_TIMESTAMP,
    attempts = j.attempts + 1,
    updated_at = CURRENT_TIMESTAMP
FROM picked p
WHERE j.job_id = p.job_id
RETURNING j.*
"""

_RECLAIM_SQL = """
UPDATE oaao_vault_job
SET status = 'queued',
    claimed_at = NULL,
    last_error = 'reclaimed_orphan_running',
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'running'
RETURNING job_id
"""


def _apply_claim_side_effects(cur: Any, row: dict[str, Any]) -> None:
    doc_id = int(row.get("document_id") or 0)
    hook = str(row.get("hook_id") or "").strip()
    if doc_id < 1:
        return
    if hook == "vh.rag.document_embed":
        cur.execute(
            """
            UPDATE oaao_vault_document SET
                embed_status = 'embedding',
                embed_error = NULL,
                last_job_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = %s
               AND embed_status <> 'embedded'
            """,
            (doc_id,),
        )
    elif hook == "vh.rag.graph_index":
        cur.execute(
            """
            UPDATE oaao_vault_document SET
                graph_status = 'building',
                graph_error = NULL,
                graph_started_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = %s
            """,
            (doc_id,),
        )
    elif hook == "vh.rag.transcript_summary":
        cur.execute("SELECT meta_json FROM oaao_vault_document WHERE id = %s FOR UPDATE", (doc_id,))
        doc_row = cur.fetchone()
        if not doc_row:
            return
        meta_raw = doc_row.get("meta_json") if isinstance(doc_row, dict) else doc_row[0]
        meta_root: dict[str, Any] = {}
        if isinstance(meta_raw, str) and meta_raw.strip():
            try:
                dec = json.loads(meta_raw)
                if isinstance(dec, dict):
                    meta_root = dec
            except json.JSONDecodeError:
                meta_root = {}
        ts = meta_root.get("transcript_summary")
        if not isinstance(ts, dict):
            ts = {}
        ts["status"] = "generating"
        meta_root["transcript_summary"] = ts
        cur.execute(
            "UPDATE oaao_vault_document SET meta_json = %s, last_job_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (json.dumps(meta_root, ensure_ascii=False), doc_id),
        )


def _row_to_job(row: dict[str, Any]) -> dict[str, Any]:
    payload = None
    pj = row.get("payload_json")
    if isinstance(pj, str) and pj.strip():
        try:
            payload = json.loads(pj)
        except json.JSONDecodeError:
            payload = {"raw_payload_json": pj}
        if not isinstance(payload, dict):
            payload = {"raw_payload_json": pj}
    absolute_path = None
    if isinstance(payload, dict):
        sr = str(payload.get("storage_root") or "").rstrip("/")
        rp = str(payload.get("relative_path") or "").lstrip("/")
        if sr and rp:
            absolute_path = f"{sr}/{rp}"
    return {
        "job_id": int(row.get("job_id") or 0),
        "document_id": int(row.get("document_id") or 0),
        "vault_id": int(row.get("vault_id") or 0),
        "workspace_id": int(row["workspace_id"]) if row.get("workspace_id") is not None else None,
        "hook_id": str(row.get("hook_id") or ""),
        "status": str(row.get("status") or ""),
        "attempts": int(row.get("attempts") or 0),
        "payload": payload,
        "absolute_path": absolute_path,
    }


def reclaim_orphan_running_jobs() -> int:
    if not pool_available():
        return 0
    from psycopg.rows import dict_row  # noqa: PLC0415

    with pg_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(_RECLAIM_SQL)
            rows = cur.fetchall()
            conn.commit()
    count = len(rows)
    if count:
        logger.info("vault_job_pg: reclaimed %s orphan running job(s)", count)
    return count


def claim_next_job(*, hook_id: str = "") -> dict[str, Any] | None:
    if not pool_available():
        return None
    hook_filter = ""
    params: list[Any] = []
    if hook_id.strip():
        hook_filter = " AND hook_id = %s"
        params.append(hook_id.strip())
    sql = _CLAIM_SQL.format(hook_filter=hook_filter)
    from psycopg.rows import dict_row  # noqa: PLC0415

    with pg_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            if row is None:
                conn.commit()
                return None
            if not isinstance(row, dict):
                row = dict(row)
            _apply_claim_side_effects(cur, row)
            conn.commit()
    return _row_to_job(row)
