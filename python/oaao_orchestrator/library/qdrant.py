"""Library Qdrant helpers — tenant-scoped collection ``library_{tenant_id}``."""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any

import httpx

from oaao_orchestrator.vault_rag.embed import _env, _resolve_secret, ensure_url_scheme

logger = logging.getLogger(__name__)


def library_collection_name(tenant_id: int) -> str:
    tid = max(1, int(tenant_id))
    return f"library_{tid}"


def default_qdrant_url() -> str:
    return _env("OAAO_QDRANT_URL", "http://qdrant:6333").rstrip("/")


def _qdrant_headers(api_key: str | None) -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if api_key:
        h["api-key"] = api_key
    return h


def _stable_point_uuid(tenant_id: int, document_id: int, chunk_idx: int) -> str:
    ns = uuid.UUID("a1b2c3d4-e5f6-4789-a012-3456789abcde")
    return str(uuid.uuid5(ns, f"oaao_library|{tenant_id}|{document_id}|{chunk_idx}"))


def _library_must_filter(
    tenant_id: int,
    document_ids: list[int] | None = None,
) -> dict[str, Any]:
    must: list[dict[str, Any]] = [{"key": "tenant_id", "match": {"value": int(tenant_id)}}]
    if document_ids:
        clean = sorted({int(x) for x in document_ids if int(x) > 0})
        if len(clean) == 1:
            must.append({"key": "document_id", "match": {"value": clean[0]}})
        elif len(clean) > 1:
            must.append({"key": "document_id", "match": {"any": clean}})
    return {"must": must}


async def ensure_collection(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    collection: str,
    vector_size: int,
    api_key: str | None,
) -> bool:
    bu = ensure_url_scheme(base_url).rstrip("/")
    headers = _qdrant_headers(api_key)
    r = await client.get(f"{bu}/collections/{collection}", headers=headers, timeout=30.0)
    if r.status_code == 200:
        return True
    body = {"vectors": {"size": vector_size, "distance": "Cosine"}}
    r2 = await client.put(
        f"{bu}/collections/{collection}",
        headers=headers,
        json=body,
        timeout=60.0,
    )
    return r2.status_code in (200, 201)


async def delete_document_points(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    collection: str,
    api_key: str | None,
    tenant_id: int,
    document_id: int,
) -> None:
    bu = ensure_url_scheme(base_url).rstrip("/")
    body = {
        "filter": {
            "must": [
                {"key": "tenant_id", "match": {"value": int(tenant_id)}},
                {"key": "document_id", "match": {"value": int(document_id)}},
            ],
        },
        "wait": True,
    }
    try:
        await client.post(
            f"{bu}/collections/{collection}/points/delete",
            headers=_qdrant_headers(api_key),
            json=body,
            timeout=90.0,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("library qdrant delete failed doc=%s: %s", document_id, exc)


async def upsert_chunks(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    collection: str,
    api_key: str | None,
    tenant_id: int,
    document_id: int,
    revision_id: int | None,
    title: str,
    chunk_rows: list[tuple[int, list[float], str]],
) -> bool:
    if not chunk_rows:
        return True
    bu = ensure_url_scheme(base_url).rstrip("/")
    url = f"{bu}/collections/{collection}/points?wait=true"
    headers = _qdrant_headers(api_key)
    batch = 48
    for off in range(0, len(chunk_rows), batch):
        slice_ = chunk_rows[off : off + batch]
        points: list[dict[str, Any]] = []
        for idx, vector, snippet in slice_:
            payload: dict[str, Any] = {
                "tenant_id": int(tenant_id),
                "document_id": int(document_id),
                "chunk_index": idx,
                "text": snippet[:32000],
            }
            if title:
                payload["title"] = title[:512]
            if revision_id is not None and revision_id > 0:
                payload["revision_id"] = int(revision_id)
            points.append(
                {
                    "id": _stable_point_uuid(tenant_id, document_id, idx),
                    "vector": vector,
                    "payload": payload,
                }
            )
        r = await client.put(url, headers=headers, json={"points": points}, timeout=120.0)
        if r.status_code >= 400:
            logger.warning("library qdrant upsert HTTP %s — %s", r.status_code, r.text[:400])
            return False
    return True


async def search_points(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    collection: str,
    api_key: str | None,
    tenant_id: int,
    vector: list[float],
    document_ids: list[int] | None,
    limit: int,
) -> list[dict[str, Any]]:
    bu = ensure_url_scheme(base_url).rstrip("/")
    url = f"{bu}/collections/{collection}/points/search"
    flt = _library_must_filter(tenant_id, document_ids)
    body: dict[str, Any] = {
        "vector": vector,
        "limit": max(1, min(32, limit)),
        "with_payload": True,
        "filter": flt,
    }
    r = await client.post(url, headers=_qdrant_headers(api_key), json=body, timeout=40.0)
    if r.status_code >= 400:
        logger.warning("library qdrant search HTTP %s — %s", r.status_code, r.text[:400])
        return []
    try:
        data = r.json()
    except Exception:  # noqa: BLE001
        return []
    res = data.get("result") if isinstance(data, dict) else None
    return res if isinstance(res, list) else []


def resolve_embedding_cfg(payload: dict[str, Any]) -> tuple[str, str, str | None]:
    emb = payload.get("embedding_cfg") if isinstance(payload.get("embedding_cfg"), dict) else {}
    base = str(emb.get("base_url") or os.environ.get("OAAO_EMBEDDING_URL", "")).strip()
    model = str(emb.get("model") or os.environ.get("OAAO_EMBEDDING_MODEL", "bge-m3")).strip()
    key_env = emb.get("api_key_env") if isinstance(emb.get("api_key_env"), str) else None
    api_key = _resolve_secret(key_env.strip()) if key_env and key_env.strip() else None
    return base, model, api_key


def resolve_qdrant_api_key(payload: dict[str, Any]) -> str | None:
    q = payload.get("qdrant") if isinstance(payload.get("qdrant"), dict) else {}
    env_name = q.get("api_key_env") if isinstance(q.get("api_key_env"), str) else None
    if env_name and env_name.strip():
        return _resolve_secret(env_name.strip())
    return _resolve_secret(_env("OAAO_QDRANT_API_KEY_ENV", "")) or None
