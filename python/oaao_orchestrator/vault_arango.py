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


def _viz_element_id(el: dict[str, Any]) -> str:
    data = el.get("data") if isinstance(el.get("data"), dict) else el
    if not isinstance(data, dict):
        return ""
    return str(data.get("id") or "").strip()


def _viz_edge_endpoints(el: dict[str, Any]) -> tuple[str, str]:
    data = el.get("data") if isinstance(el.get("data"), dict) else el
    if not isinstance(data, dict):
        return "", ""
    return str(data.get("source") or "").strip(), str(data.get("target") or "").strip()


def prune_graph_viz_elements(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    *,
    node_limit: int = 36,
    max_isolated: int = 10,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    """Keep the largest connected cluster; drop degree-0 nodes that break force layout."""
    stats = {
        "total_nodes": len(nodes),
        "total_edges": len(edges),
        "displayed_nodes": 0,
        "displayed_edges": 0,
        "dropped_isolated": 0,
    }
    cap = max(4, min(80, int(node_limit)))
    iso_cap = max(4, min(16, int(max_isolated)))

    node_by_id: dict[str, dict[str, Any]] = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        nid = _viz_element_id(node)
        if nid and nid not in node_by_id:
            node_by_id[nid] = node

    valid_edges: list[dict[str, Any]] = []
    seen_e: set[str] = set()
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        eid = _viz_element_id(edge) or ""
        src, tgt = _viz_edge_endpoints(edge)
        if not src or not tgt or src == tgt:
            continue
        if src not in node_by_id or tgt not in node_by_id:
            continue
        dedupe = eid or f"{src}->{tgt}"
        if dedupe in seen_e:
            continue
        seen_e.add(dedupe)
        valid_edges.append(edge)

    if not valid_edges:
        kept = list(node_by_id.values())[:iso_cap]
        stats["displayed_nodes"] = len(kept)
        stats["dropped_isolated"] = max(0, len(node_by_id) - len(kept))
        return kept, [], stats

    adj: dict[str, set[str]] = {}
    edge_count: dict[str, int] = {}
    for edge in valid_edges:
        src, tgt = _viz_edge_endpoints(edge)
        adj.setdefault(src, set()).add(tgt)
        adj.setdefault(tgt, set()).add(src)
        edge_count[src] = edge_count.get(src, 0) + 1
        edge_count[tgt] = edge_count.get(tgt, 0) + 1

    visited: set[str] = set()
    components: list[set[str]] = []
    for start in adj:
        if start in visited:
            continue
        stack = [start]
        comp: set[str] = set()
        while stack:
            cur = stack.pop()
            if cur in visited:
                continue
            visited.add(cur)
            comp.add(cur)
            stack.extend(n for n in adj.get(cur, ()) if n not in visited)
        if comp:
            components.append(comp)

    if not components:
        kept = list(node_by_id.values())[:iso_cap]
        stats["displayed_nodes"] = len(kept)
        stats["dropped_isolated"] = max(0, len(node_by_id) - len(kept))
        return kept, [], stats

    def comp_score(comp: set[str]) -> tuple[int, int]:
        internal = 0
        for edge in valid_edges:
            src, tgt = _viz_edge_endpoints(edge)
            if src in comp and tgt in comp:
                internal += 1
        return internal, len(comp)

    components.sort(key=comp_score, reverse=True)
    keep_ids = set(components[0])
    if len(keep_ids) > cap:
        ranked = sorted(
            keep_ids,
            key=lambda nid: (
                edge_count.get(nid, 0),
                len(
                    str(
                        (node_by_id[nid].get("data") or {}).get("label", "")
                        if isinstance(node_by_id[nid].get("data"), dict)
                        else ""
                    )
                ),
            ),
            reverse=True,
        )
        keep_ids = set(ranked[:cap])

    kept_nodes = [node_by_id[nid] for nid in keep_ids if nid in node_by_id]
    kept_edges: list[dict[str, Any]] = []
    seen_kept: set[str] = set()
    for edge in valid_edges:
        src, tgt = _viz_edge_endpoints(edge)
        if src not in keep_ids or tgt not in keep_ids:
            continue
        dedupe = _viz_element_id(edge) or f"{src}->{tgt}"
        if dedupe in seen_kept:
            continue
        seen_kept.add(dedupe)
        kept_edges.append(edge)

    stats["displayed_nodes"] = len(kept_nodes)
    stats["displayed_edges"] = len(kept_edges)
    stats["dropped_isolated"] = max(0, len(node_by_id) - len(kept_nodes))
    return kept_nodes, kept_edges, stats


async def query_graph_elements_for_viz(
    client: httpx.AsyncClient,
    profile: dict[str, Any],
    *,
    query: str,
    document_ids: list[int] | None = None,
    node_limit: int = 36,
    edge_limit: int = 64,
) -> dict[str, Any]:
    """Return Cytoscape.js elements for matched entities + relations in a vault."""
    cfg = resolve_arango_from_profile(profile)
    if cfg is None:
        return {"nodes": [], "edges": []}

    vid = int(profile.get("vault_id") or 0)
    if vid < 1:
        return {"nodes": [], "edges": []}

    doc_ids = [
        int(x) for x in (document_ids or []) if isinstance(x, (int, str)) and str(x).isdigit()
    ][:48]
    tokens = _query_tokens(query)
    if not tokens:
        return {"nodes": [], "edges": []}

    entity_aql = """
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
      LIMIT @node_limit
      RETURN {
        key: e._key,
        name: e.name,
        entity_type: e.entity_type,
        document_id: e.document_id,
        context: e.context
      }
    """
    rows = await _run_aql(
        client,
        cfg,
        entity_aql,
        {
            "@entity": ENTITY_COLLECTION,
            "vault_id": vid,
            "document_ids": doc_ids,
            "doc_filter": len(doc_ids) > 0,
            "tokens": tokens,
            "node_limit": max(8, min(22, max(4, min(80, int(node_limit))))),
        },
    )

    key_set: set[str] = set()
    nodes: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or "").strip()
        name = str(row.get("name") or "").strip()
        if not key or not name:
            continue
        key_set.add(key)
        nodes.append(
            {
                "data": {
                    "id": key,
                    "label": name[:80],
                    "type": str(row.get("entity_type") or "concept")[:80],
                    "document_id": int(row.get("document_id") or 0),
                }
            }
        )

    if not key_set:
        return {"nodes": [], "edges": []}

    max_nodes = max(4, min(80, int(node_limit)))
    edge_cap = max(12, min(200, int(edge_limit) * 2))
    node_by_key = {str(n["data"]["id"]): n for n in nodes if isinstance(n.get("data"), dict)}

    edge_aql = """
    FOR ed IN @@edge
      FILTER ed.vault_id == @vault_id
      LET fk = PARSE_IDENTIFIER(ed._from).key
      LET tk = PARSE_IDENTIFIER(ed._to).key
      FILTER fk IN @seed_keys OR tk IN @seed_keys
      LIMIT @edge_limit
      RETURN {
        id: CONCAT(fk, "->", tk, ":", ed.relation),
        source: fk,
        target: tk,
        relation: ed.relation
      }
    """
    edge_rows = await _run_aql(
        client,
        cfg,
        edge_aql,
        {
            "@edge": EDGE_COLLECTION,
            "vault_id": vid,
            "seed_keys": list(key_set),
            "edge_limit": edge_cap,
        },
    )

    endpoint_keys: set[str] = set(key_set)
    for row in edge_rows:
        if not isinstance(row, dict):
            continue
        src = str(row.get("source") or "").strip()
        tgt = str(row.get("target") or "").strip()
        if src:
            endpoint_keys.add(src)
        if tgt:
            endpoint_keys.add(tgt)

    neighbor_keys = endpoint_keys - key_set
    if neighbor_keys and len(node_by_key) < max_nodes:
        neighbor_aql = """
        FOR e IN @@entity
          FILTER e.vault_id == @vault_id
          FILTER e._key IN @neighbor_keys
          FILTER @doc_filter == false OR e.document_id IN @document_ids
          SORT e.name ASC
          LIMIT @limit
          RETURN {
            key: e._key,
            name: e.name,
            entity_type: e.entity_type,
            document_id: e.document_id
          }
        """
        neighbor_rows = await _run_aql(
            client,
            cfg,
            neighbor_aql,
            {
                "@entity": ENTITY_COLLECTION,
                "vault_id": vid,
                "neighbor_keys": list(neighbor_keys),
                "document_ids": doc_ids,
                "doc_filter": len(doc_ids) > 0,
                "limit": max(0, max_nodes - len(node_by_key)),
            },
        )
        for row in neighbor_rows:
            if not isinstance(row, dict):
                continue
            key = str(row.get("key") or "").strip()
            name = str(row.get("name") or "").strip()
            if not key or not name or key in node_by_key:
                continue
            node_by_key[key] = {
                "data": {
                    "id": key,
                    "label": name[:80],
                    "type": str(row.get("entity_type") or "concept")[:80],
                    "document_id": int(row.get("document_id") or 0),
                }
            }

    expanded_keys = set(node_by_key.keys())
    if len(expanded_keys) >= 2:
        inner_edge_aql = """
        FOR ed IN @@edge
          FILTER ed.vault_id == @vault_id
          LET fk = PARSE_IDENTIFIER(ed._from).key
          LET tk = PARSE_IDENTIFIER(ed._to).key
          FILTER fk IN @keys AND tk IN @keys
          LIMIT @edge_limit
          RETURN {
            id: CONCAT(fk, "->", tk, ":", ed.relation),
            source: fk,
            target: tk,
            relation: ed.relation
          }
        """
        inner_rows = await _run_aql(
            client,
            cfg,
            inner_edge_aql,
            {
                "@edge": EDGE_COLLECTION,
                "vault_id": vid,
                "keys": list(expanded_keys),
                "edge_limit": edge_cap,
            },
        )
        seen_edge_ids: set[str] = set()
        for row in edge_rows:
            if isinstance(row, dict):
                eid = str(row.get("id") or "").strip()
                if eid:
                    seen_edge_ids.add(eid)
        for row in inner_rows:
            if not isinstance(row, dict):
                continue
            eid = str(row.get("id") or "").strip()
            if eid and eid not in seen_edge_ids:
                seen_edge_ids.add(eid)
                edge_rows.append(row)

    final_keys = set(node_by_key.keys())
    nodes = list(node_by_key.values())[:max_nodes]

    edges: list[dict[str, Any]] = []
    seen_e: set[str] = set()
    for row in edge_rows:
        if not isinstance(row, dict):
            continue
        eid = str(row.get("id") or "").strip()
        src = str(row.get("source") or "").strip()
        tgt = str(row.get("target") or "").strip()
        if not eid or not src or not tgt or eid in seen_e:
            continue
        if src not in final_keys or tgt not in final_keys:
            continue
        seen_e.add(eid)
        edges.append(
            {
                "data": {
                    "id": eid[:200],
                    "source": src,
                    "target": tgt,
                    "label": str(row.get("relation") or "related")[:80],
                }
            }
        )

    pruned_nodes, pruned_edges, stats = prune_graph_viz_elements(
        nodes,
        edges,
        node_limit=max_nodes,
        max_isolated=10,
    )
    return {"nodes": pruned_nodes, "edges": pruned_edges, "stats": stats}
