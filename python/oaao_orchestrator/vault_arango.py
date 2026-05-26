"""ArangoDB helpers for vault GraphRAG — schema, index writes, chat retrieval."""

from __future__ import annotations

import hashlib
import logging
import os
import re
from typing import Any

import httpx

from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)

ENTITY_COLLECTION = "oaao_vault_entity"
EDGE_COLLECTION = "oaao_vault_edge"


def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


def _resolve_secret(env_name: str | None) -> str | None:
    if not env_name:
        return None
    v = os.environ.get(env_name.strip())
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def resolve_arango_from_profile(profile: dict[str, Any]) -> dict[str, Any] | None:
    """Map chat retrieval profile or job graphrag.arango block to connection fields."""
    url = str(profile.get("url") or profile.get("arango_url") or "").strip()
    database = str(profile.get("database") or profile.get("arango_database") or "").strip()
    if not url:
        url = _env(
            "OAAO_ARANGO_URL",
            "http://arangodb:8529" if _env("OAAO_DOCKER", "") in ("1", "true", "yes") else "",
        )
    if not database:
        database = _env("OAAO_ARANGO_DATABASE", "oaao_vault")
    user_env = profile.get("user_env") or profile.get("arango_user_env")
    pass_env = profile.get("password_env") or profile.get("arango_password_env")
    user = (
        _resolve_secret(str(user_env))
        if user_env
        else _resolve_secret(_env("OAAO_ARANGO_USER", "root"))
    )
    password = (
        _resolve_secret(str(pass_env))
        if pass_env
        else _resolve_secret(_env("OAAO_ARANGO_PASSWORD", ""))
    )
    if not url or not database or not user:
        return None
    return {
        "url": ensure_url_scheme(url).rstrip("/"),
        "database": database,
        "user": user,
        "password": password or "",
    }


def _entity_key(vault_id: int, document_id: int, name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")[:48] or "entity"
    h = hashlib.sha1(f"{vault_id}|{document_id}|{name}".encode()).hexdigest()[:10]
    return f"v{vault_id}_d{document_id}_{slug}_{h}"[:254]


def _query_tokens(text: str, *, limit: int = 8) -> list[str]:
    raw = re.findall(r"[A-Za-z0-9\u4e00-\u9fff]{3,}", (text or "").lower())
    out: list[str] = []
    seen: set[str] = set()
    for t in raw:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= limit:
            break
    return out


async def _arango_request(
    client: httpx.AsyncClient,
    *,
    cfg: dict[str, Any],
    method: str,
    path: str,
    json_body: dict[str, Any] | None = None,
    use_db: bool = True,
    timeout: float = 45.0,
) -> httpx.Response | None:
    base = cfg["url"].rstrip("/")
    if use_db:  # noqa: SIM108
        url = f"{base}/_db/{cfg['database']}{path}"
    else:
        url = f"{base}{path}"
    auth = (cfg["user"], cfg.get("password") or "")
    try:
        r = await client.request(
            method, url, json=json_body, auth=auth, timeout=httpx.Timeout(timeout, connect=10.0)
        )
        return r
    except Exception as e:  # noqa: BLE001
        logger.warning("vault_arango: request %s %s failed — %s", method, path, e)
        return None


async def ensure_graph_schema(client: httpx.AsyncClient, cfg: dict[str, Any]) -> bool:
    """Create database (best-effort) + document/edge collections."""
    db_name = cfg["database"]
    r_db = await _arango_request(
        client,
        cfg=cfg,
        method="POST",
        path="/_api/database",
        json_body={"name": db_name},
        use_db=False,
    )
    if r_db is not None and r_db.status_code not in (200, 201, 409):
        logger.warning(
            "vault_arango: create database HTTP %s — %s", r_db.status_code, (r_db.text or "")[:300]
        )

    for col, kind in ((ENTITY_COLLECTION, 2), (EDGE_COLLECTION, 3)):
        r_col = await _arango_request(
            client,
            cfg=cfg,
            method="POST",
            path="/_api/collection",
            json_body={"name": col, "type": kind, "edgeCollection": kind == 3},
        )
        if r_col is not None and r_col.status_code not in (200, 201, 409):
            logger.warning("vault_arango: create collection %s HTTP %s", col, r_col.status_code)
            return False

    r_edge = await _arango_request(
        client,
        cfg=cfg,
        method="POST",
        path="/_api/collection",
        json_body={"name": EDGE_COLLECTION, "type": 3, "edgeCollection": True},
    )
    if r_edge is not None and r_edge.status_code not in (200, 201, 409):
        logger.warning("vault_arango: edge collection create failed HTTP %s", r_edge.status_code)
        return False
    return True


async def delete_document_graph(
    client: httpx.AsyncClient,
    cfg: dict[str, Any],
    *,
    vault_id: int,
    document_id: int,
) -> None:
    aql = """
    FOR e IN @@entity
      FILTER e.vault_id == @vault_id AND e.document_id == @document_id
      REMOVE e IN @@entity
    """
    await _run_aql(
        client,
        cfg,
        aql,
        {
            "@entity": ENTITY_COLLECTION,
            "vault_id": int(vault_id),
            "document_id": int(document_id),
        },
    )


async def upsert_graph_batch(
    client: httpx.AsyncClient,
    cfg: dict[str, Any],
    *,
    vault_id: int,
    document_id: int,
    entities: list[dict[str, Any]],
    relations: list[dict[str, Any]],
    segment_label: str = "",
) -> tuple[int, int]:
    """Insert entities + edges; returns (entity_count, edge_count)."""
    key_to_id: dict[str, str] = {}
    entity_docs: list[dict[str, Any]] = []
    for ent in entities:
        name = str(ent.get("name") or "").strip()
        if not name:
            continue
        key = _entity_key(vault_id, document_id, name)
        key_to_id[name.lower()] = key
        doc = {
            "_key": key,
            "vault_id": int(vault_id),
            "document_id": int(document_id),
            "name": name[:512],
            "entity_type": str(ent.get("type") or ent.get("entity_type") or "concept")[:120],
            "context": str(ent.get("context") or "")[:4000],
            "segment_label": (segment_label or str(ent.get("segment_label") or ""))[:512],
        }
        page = ent.get("page")
        if isinstance(page, int) and page > 0:
            doc["page"] = page
        entity_docs.append(doc)

    if not entity_docs:
        return 0, 0

    r = await _arango_request(
        client,
        cfg=cfg,
        method="POST",
        path=f"/_api/document/{ENTITY_COLLECTION}?overwriteMode=replace",
        json_body=entity_docs if len(entity_docs) > 1 else entity_docs[0],
    )
    if r is None or r.status_code >= 400:
        logger.warning(
            "vault_arango: entity upsert HTTP %s — %s",
            r.status_code if r else "?",
            (r.text if r else "")[:400],
        )
        return 0, 0

    edge_col = EDGE_COLLECTION
    edge_docs: list[dict[str, Any]] = []
    for rel in relations:
        src = str(rel.get("from") or rel.get("source") or "").strip().lower()
        dst = str(rel.get("to") or rel.get("target") or "").strip().lower()
        if not src or not dst:
            continue
        fk = key_to_id.get(src)
        tk = key_to_id.get(dst)
        if not fk or not tk:
            continue
        relation = str(rel.get("relation") or rel.get("type") or "related_to")[:160]
        edge_docs.append(
            {
                "_from": f"{ENTITY_COLLECTION}/{fk}",
                "_to": f"{ENTITY_COLLECTION}/{tk}",
                "vault_id": int(vault_id),
                "document_id": int(document_id),
                "relation": relation,
            },
        )

    if edge_docs:
        r_e = await _arango_request(
            client,
            cfg=cfg,
            method="POST",
            path=f"/_api/document/{edge_col}?overwriteMode=replace",
            json_body=edge_docs if len(edge_docs) > 1 else edge_docs[0],
        )
        if r_e is None or r_e.status_code >= 400:
            logger.warning("vault_arango: edge upsert HTTP %s", r_e.status_code if r_e else "?")
            return len(entity_docs), 0

    return len(entity_docs), len(edge_docs)


async def _run_aql(
    client: httpx.AsyncClient,
    cfg: dict[str, Any],
    aql: str,
    bind_vars: dict[str, Any],
) -> list[Any]:
    r = await _arango_request(
        client,
        cfg=cfg,
        method="POST",
        path="/_api/cursor",
        json_body={"query": aql, "bindVars": bind_vars},
    )
    if r is None or r.status_code >= 400:
        return []
    try:
        data = r.json()
    except Exception:  # noqa: BLE001
        return []
    res = data.get("result") if isinstance(data, dict) else None
    return res if isinstance(res, list) else []


async def query_graph_context_lines(
    client: httpx.AsyncClient,
    profile: dict[str, Any],
    *,
    query: str,
    document_ids: list[int] | None = None,
    limit: int = 12,
) -> list[str]:
    """Return short graph lines for chat system prompt injection."""
    custom_aql = _env("OAAO_ARANGO_RAG_AQL", "").strip()
    cfg = resolve_arango_from_profile(profile)
    if cfg is None:
        return []

    vid = int(profile.get("vault_id") or 0)
    if vid < 1:
        return []

    doc_ids = [
        int(x) for x in (document_ids or []) if isinstance(x, (int, str)) and str(x).isdigit()
    ]
    doc_ids = doc_ids[:48]

    if custom_aql:
        bind: dict[str, Any] = {"vault_id": vid, "document_ids": doc_ids, "query": query[:2000]}
        rows = await _run_aql(client, cfg, custom_aql, bind)
        lines: list[str] = []
        for row in rows[:limit]:
            if isinstance(row, str) and row.strip():
                s = row.strip().replace("\n", " ")
                lines.append(s[:360] + ("…" if len(s) > 360 else ""))
        return lines

    tokens = _query_tokens(query)
    if not tokens:
        return []

    aql = """
    FOR e IN @@entity
      FILTER e.vault_id == @vault_id
      FILTER @doc_filter == false OR e.document_id IN @document_ids
      LET nm = LOWER(e.name)
      LET ctx = LOWER(e.context OR "")
      LET hit = LENGTH(
        FOR t IN @tokens
          FILTER CONTAINS(nm, t) OR CONTAINS(ctx, t)
          LIMIT 1
          RETURN 1
      ) > 0
      FILTER hit
      SORT e.document_id ASC, e.name ASC
      LIMIT @limit
      RETURN CONCAT(
        "Entity: ", e.name,
        " (", e.entity_type, ")",
        e.page ? CONCAT(" · p.", TO_STRING(e.page)) : "",
        e.segment_label ? CONCAT(" · ", e.segment_label) : "",
        e.context ? CONCAT(" — ", SUBSTRING(e.context, 0, 180)) : ""
      )
    """
    entity_lines = await _run_aql(
        client,
        cfg,
        aql,
        {
            "@entity": ENTITY_COLLECTION,
            "vault_id": vid,
            "document_ids": doc_ids,
            "doc_filter": len(doc_ids) > 0,
            "tokens": tokens,
            "limit": max(4, min(20, limit)),
        },
    )

    rel_aql = """
    FOR e IN @@entity
      FILTER e.vault_id == @vault_id
      FILTER @doc_filter == false OR e.document_id IN @document_ids
      LET nm = LOWER(e.name)
      LET ctx = LOWER(e.context OR "")
      LET hit = LENGTH(
        FOR t IN @tokens
          FILTER CONTAINS(nm, t) OR CONTAINS(ctx, t)
          LIMIT 1
          RETURN 1
      ) > 0
      FILTER hit
      FOR v, ed IN 1..1 OUTBOUND e @@edge
        FILTER v.vault_id == @vault_id
        LIMIT @limit
        RETURN CONCAT(
          "Relation: ", e.name, " —[", ed.relation, "]→ ", v.name,
          v.context ? CONCAT(" (", SUBSTRING(v.context, 0, 120), ")") : ""
        )
    """
    rel_lines = await _run_aql(
        client,
        cfg,
        rel_aql,
        {
            "@entity": ENTITY_COLLECTION,
            "@edge": EDGE_COLLECTION,
            "vault_id": vid,
            "document_ids": doc_ids,
            "doc_filter": len(doc_ids) > 0,
            "tokens": tokens,
            "limit": max(4, min(12, limit // 2)),
        },
    )

    out: list[str] = []
    for row in entity_lines + rel_lines:
        if isinstance(row, str) and row.strip():
            s = row.strip().replace("\n", " ")
            out.append(s[:380] + ("…" if len(s) > 380 else ""))
        if len(out) >= limit:
            break
    return out
