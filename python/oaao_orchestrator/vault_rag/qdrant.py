"""Vault RAG Qdrant scroll/search helpers (W7-S2 phase 1)."""
from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.vault_rag.embed import _env, _resolve_secret
from oaao_orchestrator.vault_rag.passages import PassagePick, select_passages_for_vault

logger = logging.getLogger(__name__)


def _qdrant_must_filter(
    vault_id: int,
    document_ids: list[int] | None = None,
    segment_scope: str | None = None,
) -> dict[str, Any]:
    must: list[dict[str, Any]] = [{"key": "vault_id", "match": {"value": int(vault_id)}}]
    if document_ids:
        clean = sorted({int(x) for x in document_ids if int(x) > 0})
        if len(clean) == 1:
            must.append({"key": "document_id", "match": {"value": clean[0]}})
        elif len(clean) > 1:
            must.append({"key": "document_id", "match": {"any": clean}})
    scope = (segment_scope or "").strip()
    if scope:
        must.append({"key": "segment_scope", "match": {"value": scope[:64]}})
    return {"must": must}


def _scroll_points_to_hits(points: list[Any], *, score: float) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for raw in points:
        if not isinstance(raw, dict):
            continue
        pl = raw.get("payload")
        if not isinstance(pl, dict):
            pl = {}
        hits.append({"score": score, "payload": pl, "id": raw.get("id")})
    return hits


async def _qdrant_scroll(
    *,
    base_url: str,
    collection: str,
    vault_id: int,
    api_key: str | None,
    limit: int,
    document_ids: list[int] | None = None,
    segment_scope: str | None = None,
) -> list[dict[str, Any]]:
    """Filter-only point scroll — used when embedding is unavailable but scoped document ids are known."""
    bu = base_url.rstrip("/")
    url = f"{bu}/collections/{collection}/points/scroll"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["api-key"] = api_key
    flt = _qdrant_must_filter(vault_id, document_ids, segment_scope)
    body: dict[str, Any] = {"limit": max(1, min(64, limit)), "with_payload": True, "filter": flt}
    async with httpx.AsyncClient(timeout=httpx.Timeout(40.0, connect=10.0)) as client:
        r = await client.post(url, headers=headers, json=body)
        if r.status_code >= 400:
            logger.warning("qdrant scroll %s HTTP %s — %s", collection, r.status_code, r.text[:400])
            return []
        try:
            data = r.json()
        except Exception:  # noqa: BLE001
            return []
    res = data.get("result") if isinstance(data, dict) else None
    if not isinstance(res, dict):
        return []
    pts = res.get("points")
    if not isinstance(pts, list):
        return []
    return _scroll_points_to_hits(pts, score=0.92 if (segment_scope or "").strip() else 0.55)


def _scoped_docs_by_vault(
    vault_source_refs: list[dict[str, Any]] | None,
    vault_scope_documents: dict[int, list[int]] | None,
) -> dict[int, list[int]]:
    out: dict[int, list[int]] = {}
    if isinstance(vault_scope_documents, dict):
        for raw_vid, raw_ids in vault_scope_documents.items():
            try:
                vid = int(raw_vid)
            except (TypeError, ValueError):
                continue
            if vid < 1 or not isinstance(raw_ids, list):
                continue
            clean = sorted({int(x) for x in raw_ids if isinstance(x, (int, float)) and int(x) > 0})
            if clean:
                out[vid] = clean
    if out:
        return out
    for raw in vault_source_refs or []:
        if not isinstance(raw, dict):
            continue
        if str(raw.get("kind") or "").strip().lower() != "document":
            continue
        try:
            vid = int(raw.get("vault_id") or 0)
            did = int(raw.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if vid < 1 or did < 1:
            continue
        out.setdefault(vid, []).append(did)
    for vid in list(out.keys()):
        out[vid] = sorted(set(out[vid]))
    return out


async def _record_passages_via_scope_scroll(
    profiles: list[dict[str, Any]],
    scope_by_vault: dict[int, list[int]],
    *,
    per_vault_limit: int,
    min_score: float,
    seen: set[str],
    default_qdrant: str,
) -> list[PassagePick]:
    """Load transcript summaries (then other segments) for PHP-scoped audio/docs without embedding."""
    all_picks: list[PassagePick] = []
    for profile in profiles:
        vid = int(profile.get("vault_id") or 0)
        if vid < 1:
            continue
        doc_ids = scope_by_vault.get(vid)
        if not doc_ids:
            continue
        qurl = (profile.get("qdrant_url") or "").strip() or default_qdrant
        qcol = (profile.get("qdrant_collection") or "").strip()
        if not qcol:
            continue
        qkey_env = profile.get("qdrant_api_key_env")
        qkey = _resolve_secret(qkey_env) if qkey_env else None
        ranked: list[tuple[float, dict[str, Any]]] = []
        for scope, score in (("transcript_summary", 0.92), (None, 0.55)):
            hits = await _qdrant_scroll(
                base_url=qurl,
                collection=qcol,
                vault_id=vid,
                api_key=qkey,
                limit=max(8, per_vault_limit * 4),
                document_ids=doc_ids,
                segment_scope=scope,
            )
            for h in hits:
                eff = float(h.get("score") or score)
                ranked.append((eff, h))
        vault_picks, _ = select_passages_for_vault(
            ranked,
            vault_id=vid,
            per_vault_limit=per_vault_limit,
            min_score=max(0.08, min_score * 0.5),
            seen=seen,
            query_wants_record=True,
        )
        all_picks.extend(vault_picks)
    return all_picks


async def _handbook_passages_via_vault_scroll(
    profiles: list[dict[str, Any]],
    *,
    per_vault_limit: int,
    min_score: float,
    seen: set[str],
    default_qdrant: str,
) -> list[PassagePick]:
    """Whole-vault scroll when vector search returns 0 hits but embedded chunks exist (handbook PDFs)."""
    all_picks: list[PassagePick] = []
    for profile in profiles:
        vid = int(profile.get("vault_id") or 0)
        if vid < 1:
            continue
        qurl = (profile.get("qdrant_url") or "").strip() or default_qdrant
        qcol = (profile.get("qdrant_collection") or "").strip()
        if not qcol:
            continue
        qkey_env = profile.get("qdrant_api_key_env")
        qkey = _resolve_secret(qkey_env) if qkey_env else None
        hits = await _qdrant_scroll(
            base_url=qurl,
            collection=qcol,
            vault_id=vid,
            api_key=qkey,
            limit=max(16, per_vault_limit * 5),
            document_ids=None,
            segment_scope=None,
        )
        ranked: list[tuple[float, dict[str, Any]]] = []
        for h in hits:
            if not isinstance(h, dict):
                continue
            ranked.append((float(h.get("score") or 0.55), h))
        vault_picks, _ = select_passages_for_vault(
            ranked,
            vault_id=vid,
            per_vault_limit=per_vault_limit,
            min_score=max(0.08, min_score * 0.45),
            seen=seen,
            query_wants_record=False,
        )
        all_picks.extend(vault_picks)
    return all_picks


async def _qdrant_search(
    *,
    base_url: str,
    collection: str,
    vector: list[float],
    vault_id: int,
    api_key: str | None,
    limit: int,
    document_ids: list[int] | None = None,
    segment_scope: str | None = None,
) -> list[dict[str, Any]]:
    bu = base_url.rstrip("/")
    url = f"{bu}/collections/{collection}/points/search"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["api-key"] = api_key
    flt = _qdrant_must_filter(vault_id, document_ids, segment_scope)
    body: dict[str, Any] = {"vector": vector, "limit": limit, "with_payload": True, "filter": flt}
    async with httpx.AsyncClient(timeout=httpx.Timeout(40.0, connect=10.0)) as client:
        r = await client.post(url, headers=headers, json=body)
        if r.status_code == 400 and _env("OAAO_QDRANT_RETRY_WITHOUT_FILTER", "") in (
            "1",
            "true",
            "yes",
        ):
            body = {"vector": vector, "limit": limit, "with_payload": True}
            r = await client.post(url, headers=headers, json=body)
        if r.status_code >= 400:
            logger.warning("qdrant search %s HTTP %s — %s", collection, r.status_code, r.text[:400])
            return []
        try:
            data = r.json()
        except Exception:  # noqa: BLE001
            return []
    res = data.get("result") if isinstance(data, dict) else None
    return res if isinstance(res, list) else []

