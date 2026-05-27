"""Vault RAG explore — vector passages + graph visualization payload for the RAG Explore SPA."""

from __future__ import annotations

import os
import re
from typing import Any

import httpx

from oaao_orchestrator.vault_arango import prune_graph_viz_elements, query_graph_elements_for_viz
from oaao_orchestrator.vault_rag.embed import (
    _openai_embed,
    _resolve_secret,
    ensure_url_scheme,
    openai_compat_embeddings_url_from_base,
)
from oaao_orchestrator.vault_rag.passages import (
    _format_passage_detail_line,
    _passage_type_label,
    _rag_runtime_config,
    _select_passages_for_vault,
)
from oaao_orchestrator.vault_rag.qdrant import _qdrant_search


def _env(name: str, default: str = "") -> str:
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


async def explore_vault_rag(
    *,
    query: str,
    vault_retrieval_profiles: list[dict[str, Any]] | None,
    embedding: dict[str, Any] | None = None,
    rerank: dict[str, Any] | None = None,
    vault_rag: dict[str, Any] | None = None,
    vault_scope_documents: dict[int, list[int]] | None = None,
    graph_limit: int = 36,
) -> dict[str, Any]:
    """Run scoped vector search + optional graph element fetch for UI explore."""
    del rerank  # reserved for rerank-enriched explore later
    q = (query or "").strip()
    profiles = [p for p in (vault_retrieval_profiles or []) if isinstance(p, dict)]
    if not q or not profiles:
        return {"passages": [], "graph": {"nodes": [], "edges": []}, "vaults": []}

    rag_cfg = _rag_runtime_config(vault_rag if isinstance(vault_rag, dict) else None)
    per_vault_limit = int(rag_cfg["qdrant_limit"])
    min_score = float(rag_cfg["min_score"])
    default_qdrant = _env("OAAO_QDRANT_URL", "http://qdrant:6333").rstrip("/")

    emb_cfg = embedding if isinstance(embedding, dict) else {}
    mo = str(emb_cfg.get("model") or "").strip()
    bu = str(emb_cfg.get("base_url") or "").strip()
    url_direct = str(emb_cfg.get("url") or "").strip()
    ek: str | None = None
    ake = emb_cfg.get("api_key_env")
    if isinstance(ake, str) and ake.strip():
        ek = _resolve_secret(ake.strip())
    embed_url = (
        ensure_url_scheme(url_direct) if url_direct else openai_compat_embeddings_url_from_base(bu)
    )

    passages: list[dict[str, Any]] = []
    graph_nodes: list[dict[str, Any]] = []
    graph_edges: list[dict[str, Any]] = []
    vault_labels: list[dict[str, Any]] = []
    seen: set[str] = set()

    vector: list[float] | None = None
    if mo and (url_direct or bu):
        vector, _emb_err = await _openai_embed(q, ek, url=embed_url, model=mo)

    scope_docs_map = vault_scope_documents if isinstance(vault_scope_documents, dict) else {}

    async with httpx.AsyncClient() as client:
        for profile in profiles[:8]:
            vid = int(profile.get("vault_id") or 0)
            if vid < 1:
                continue
            vname = str(profile.get("vault_name") or profile.get("name") or f"Vault {vid}")
            vault_labels.append({"vault_id": vid, "name": vname})

            doc_allow = scope_docs_map.get(vid)
            scope_docs = doc_allow if isinstance(doc_allow, list) and doc_allow else None

            if vector:
                qurl = (profile.get("qdrant_url") or "").strip() or default_qdrant
                qcol = (profile.get("qdrant_collection") or "").strip()
                if qcol:
                    qkey_env = profile.get("qdrant_api_key_env")
                    qkey = _resolve_secret(qkey_env) if qkey_env else None
                    raw_hits = await _qdrant_search(
                        base_url=qurl,
                        collection=qcol,
                        vector=vector,
                        vault_id=vid,
                        api_key=qkey,
                        limit=max(2, min(16, per_vault_limit + 4)),
                        document_ids=scope_docs,
                    )
                    ranked: list[tuple[float, dict[str, Any]]] = []
                    for h in raw_hits:
                        if not isinstance(h, dict):
                            continue
                        score = float(h.get("score") or 0)
                        ranked.append((score, h))
                    ranked.sort(key=lambda x: x[0], reverse=True)
                    picks, _below = _select_passages_for_vault(
                        ranked,
                        vault_id=vid,
                        per_vault_limit=per_vault_limit,
                        min_score=min_score,
                        seen=seen,
                    )
                    for pick in picks[:8]:
                        body = pick.passage.split("\n", 1)[-1].strip()
                        excerpt = re.sub(r"\s+", " ", body)[:1200]
                        passages.append(
                            {
                                "vault_id": vid,
                                "vault_name": vname,
                                "score": round(float(pick.score), 4),
                                "document_id": int(pick.document_id or 0),
                                "file_name": (pick.file_name or "").strip()[:255],
                                "segment_label": _passage_type_label(pick.segment_type),
                                "excerpt": excerpt,
                                "text": _format_passage_detail_line(pick)[:1200],
                            }
                        )

            graphrag = profile.get("graphrag") if isinstance(profile.get("graphrag"), dict) else {}
            arango_block = graphrag.get("arango") if isinstance(graphrag.get("arango"), dict) else {}
            if arango_block or profile.get("url") or profile.get("arango_url"):
                gprof = {**profile, "vault_id": vid}
                if isinstance(arango_block, dict) and arango_block:
                    gprof = {**gprof, **arango_block}
                elements = await query_graph_elements_for_viz(
                    client,
                    gprof,
                    query=q,
                    document_ids=scope_docs,
                    node_limit=graph_limit,
                )
                graph_nodes.extend(
                    [n for n in (elements.get("nodes") or []) if isinstance(n, dict)]
                )
                graph_edges.extend(
                    [e for e in (elements.get("edges") or []) if isinstance(e, dict)]
                )

    passages.sort(key=lambda x: float(x.get("score") or 0), reverse=True)

    seen_node: set[str] = set()
    dedup_nodes: list[dict[str, Any]] = []
    for node in graph_nodes:
        if not isinstance(node, dict):
            continue
        data = node.get("data") if isinstance(node.get("data"), dict) else node
        nid = str(data.get("id") or "").strip() if isinstance(data, dict) else ""
        if not nid or nid in seen_node:
            continue
        seen_node.add(nid)
        dedup_nodes.append(node)

    seen_edge: set[str] = set()
    dedup_edges: list[dict[str, Any]] = []
    for edge in graph_edges:
        if not isinstance(edge, dict):
            continue
        data = edge.get("data") if isinstance(edge.get("data"), dict) else edge
        if not isinstance(data, dict):
            continue
        eid = str(data.get("id") or "").strip()
        src = str(data.get("source") or "").strip()
        tgt = str(data.get("target") or "").strip()
        dedupe = eid or f"{src}->{tgt}"
        if not src or not tgt or dedupe in seen_edge:
            continue
        seen_edge.add(dedupe)
        dedup_edges.append(edge)

    pruned_nodes, pruned_edges, graph_stats = prune_graph_viz_elements(
        dedup_nodes,
        dedup_edges,
        node_limit=max(24, min(56, int(graph_limit) + 12)),
        max_isolated=10,
    )

    return {
        "passages": passages[:24],
        "graph": {
            "nodes": pruned_nodes,
            "edges": pruned_edges,
            "stats": graph_stats,
        },
        "vaults": vault_labels,
    }


async def summarize_rag_explore(
    *,
    query: str,
    passages: list[dict[str, Any]] | None,
    graph: dict[str, Any] | None,
    llm: dict[str, Any] | None,
) -> dict[str, Any]:
    """One-shot LLM summary of RAG Explore passages + graph entity labels."""
    from oaao_orchestrator.chat_helpers import _chat_completions_url
    from oaao_orchestrator.vault_rag.embed import _resolve_secret, ensure_url_scheme

    q = (query or "").strip()
    rows = [p for p in (passages or []) if isinstance(p, dict)]
    g = graph if isinstance(graph, dict) else {}
    nodes = [n for n in (g.get("nodes") or []) if isinstance(n, dict)]

    if not q or (not rows and not nodes):
        return {"summary": "", "mode": "empty_context"}

    if not isinstance(llm, dict):
        return {"summary": "", "mode": "missing_llm"}

    bu = str(llm.get("base_url") or "").strip()
    model = str(llm.get("model") or "").strip()
    if not bu or not model:
        return {"summary": "", "mode": "incomplete_llm"}

    api_key = _resolve_secret(llm.get("api_key_env") if isinstance(llm.get("api_key_env"), str) else None)
    url = _chat_completions_url(ensure_url_scheme(bu))

    passage_lines: list[str] = []
    for i, row in enumerate(rows[:8], start=1):
        vault = str(row.get("vault_name") or "Vault").strip()
        score = row.get("score")
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        score_s = f" (score {score})" if score is not None else ""
        passage_lines.append(f"{i}. [{vault}]{score_s} {text[:520]}")

    entity_lines: list[str] = []
    for node in nodes[:16]:
        data = node.get("data") if isinstance(node.get("data"), dict) else node
        if not isinstance(data, dict):
            continue
        label = str(data.get("label") or data.get("name") or "").strip()
        if label:
            entity_lines.append(f"- {label[:160]}")

    user_parts = [f"User query: {q}", ""]
    if passage_lines:
        user_parts.append("Retrieved passages:")
        user_parts.extend(passage_lines)
        user_parts.append("")
    if entity_lines:
        user_parts.append("Knowledge-graph entities:")
        user_parts.extend(entity_lines)

    system = (
        "Summarize vault RAG explore hits for the user. "
        "Use Markdown: one short heading, then 3–6 bullet points. "
        "Cite vault names when relevant. No invented facts."
    )

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": "\n".join(user_parts).strip()},
        ],
        "temperature": 0.2,
        "max_tokens": 720,
        "stream": False,
    }

    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(url, headers=headers, json=body, timeout=httpx.Timeout(45.0, connect=10.0))
            if r.status_code >= 400:
                return {"summary": "", "mode": f"llm_http_{r.status_code}"}
            data = r.json()
            if isinstance(data, dict):
                choices = data.get("choices")
                if isinstance(choices, list) and choices:
                    msg = choices[0].get("message") if isinstance(choices[0], dict) else None
                    if isinstance(msg, dict):
                        content = msg.get("content")
                        if isinstance(content, str) and content.strip():
                            return {"summary": content.strip(), "mode": "llm"}
        except Exception:
            return {"summary": "", "mode": "llm_exception"}

    return {"summary": "", "mode": "empty_llm_response"}
