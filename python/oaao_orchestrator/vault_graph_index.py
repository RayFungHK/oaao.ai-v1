"""Orchestrator worker: build vault knowledge graph in Arango (`vh.rag.graph_index` jobs)."""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import httpx

from oaao_orchestrator.vault_arango import (
    delete_document_graph,
    ensure_graph_schema,
    resolve_arango_from_profile,
    upsert_graph_batch,
)
from oaao_orchestrator.vault_document_extract import TextSegment, extract_text_segments
from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

logger = logging.getLogger(__name__)

_GRAPH_EXTRACT_SYSTEM = """You extract a knowledge graph from document text for retrieval-augmented generation.
Return ONLY valid JSON (no markdown fences) with this shape:
{
  "entities": [
    {"name": "string", "type": "person|org|concept|section|regulation|other", "context": "short quote or paraphrase"}
  ],
  "relations": [
    {"from": "entity name", "to": "entity name", "relation": "verb phrase"}
  ]
}
Rules:
- Prefer concrete nouns, section/chapter titles, defined terms, and regulatory roles.
- Keep entity names stable and short; dedupe within the batch.
- relations.from / relations.to MUST match entity names exactly.
- If the text has an obvious section or chapter heading, add it as type \"section\".
- Maximum 24 entities and 32 relations per batch."""


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


def _chat_completions_url(base_url: str) -> str:
    bu = ensure_url_scheme(base_url).rstrip("/")
    if bu.endswith("/v1"):
        return f"{bu}/chat/completions"
    return f"{bu}/v1/chat/completions"


def _segment_batches(segments: list[TextSegment], *, max_chars: int) -> list[tuple[str, str, dict[str, Any]]]:
    """Group consecutive segments into LLM batches: (label, body, meta)."""
    out: list[tuple[str, str, dict[str, Any]]] = []
    buf: list[str] = []
    labels: list[str] = []
    meta: dict[str, Any] = {}
    size = 0

    def flush() -> None:
        nonlocal buf, labels, meta, size
        if not buf:
            return
        body = "\n\n".join(buf).strip()
        label = labels[0] if labels else "document"
        if body:
            out.append((label, body, dict(meta)))
        buf = []
        labels = []
        meta = {}
        size = 0

    for seg in segments:
        piece = seg.body.strip()
        if not piece:
            continue
        prefix = f"[{seg.label}]\n" if seg.label else ""
        block = prefix + piece
        if size + len(block) > max_chars and buf:
            flush()
        buf.append(block)
        labels.append(seg.label or seg.scope)
        for k, v in seg.meta.items():
            if v is not None and v != "" and k not in meta:
                meta[k] = v
        size += len(block)

    flush()
    return out


def _parse_graph_json(raw: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    text = (raw or "").strip()
    if not text:
        return [], []
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.I)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return [], []
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return [], []

    if not isinstance(data, dict):
        return [], []
    entities = data.get("entities")
    relations = data.get("relations")
    ent_out = [e for e in entities if isinstance(e, dict)] if isinstance(entities, list) else []
    rel_out = [r for r in relations if isinstance(r, dict)] if isinstance(relations, list) else []
    return ent_out, rel_out


async def _llm_extract_graph(
    client: httpx.AsyncClient,
    *,
    text: str,
    segment_label: str,
    graph_cfg: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str | None]:
    bu = str(graph_cfg.get("base_url") or "").strip()
    mo = str(graph_cfg.get("model") or "").strip()
    if not bu or not mo:
        return [], [], "graph_model_unconfigured"
    url = _chat_completions_url(bu)
    api_key = _resolve_secret(graph_cfg.get("api_key_env") if isinstance(graph_cfg.get("api_key_env"), str) else None)

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    user_msg = f"Segment: {segment_label}\n\nDocument excerpt:\n{text[:14000]}"
    body: dict[str, Any] = {
        "model": mo,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": _GRAPH_EXTRACT_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
    }

    try:
        r = await client.post(url, headers=headers, json=body, timeout=httpx.Timeout(120.0, connect=15.0))
    except httpx.TimeoutException as e:
        return [], [], f"graph_llm_timeout:{e}"
    except httpx.RequestError as e:
        return [], [], f"graph_llm_request_error:{e}"

    if r.status_code >= 400:
        return [], [], f"graph_llm_http_{r.status_code}:{(r.text or '')[:300]}"

    try:
        payload = r.json()
    except Exception:  # noqa: BLE001
        return [], [], "graph_llm_invalid_json"

    choices = payload.get("choices") if isinstance(payload, dict) else None
    if not isinstance(choices, list) or not choices:
        return [], [], "graph_llm_empty_choices"
    msg = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = msg.get("content") if isinstance(msg, dict) else None
    if not isinstance(content, str) or not content.strip():
        return [], [], "graph_llm_empty_content"

    entities, relations = _parse_graph_json(content)
    for ent in entities:
        if segment_label and not ent.get("segment_label"):
            ent["segment_label"] = segment_label
    return entities, relations, None


async def process_vault_graph_index(client: httpx.AsyncClient, job: dict[str, Any]) -> tuple[str, str | None, dict[str, Any]]:
    hook = str(job.get("hook_id") or "")
    if hook != "vh.rag.graph_index":
        return "failed", f"unsupported_hook:{hook}", {}

    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    vault_id = int(payload.get("vault_id") if isinstance(payload, dict) else job.get("vault_id") or 0)
    document_id = int(payload.get("document_id") if isinstance(payload, dict) else job.get("document_id") or 0)
    if vault_id < 1 or document_id < 1:
        return "failed", "missing_vault_or_document_id", {}

    graphrag = payload.get("graphrag") if isinstance(payload.get("graphrag"), dict) else {}
    graph_cfg = graphrag.get("graph") if isinstance(graphrag.get("graph"), dict) else {}
    if not graph_cfg.get("model") or not graph_cfg.get("base_url"):
        return "failed", "vault_graph_missing_graph_purpose_configure_graph_primary", {}

    arango_block = graphrag.get("arango") if isinstance(graphrag.get("arango"), dict) else {}
    arango_cfg = resolve_arango_from_profile(arango_block)
    if arango_cfg is None:
        return "failed", "vault_graph_missing_arango_connection", {}

    mime = str((payload.get("mime_type") if isinstance(payload, dict) else "") or "").strip()
    abs_path = str(job.get("absolute_path") or "").strip()
    if abs_path == "" and isinstance(payload, dict):
        sr = str(payload.get("storage_root") or "").rstrip("/")
        rp = str(payload.get("relative_path") or "").lstrip("/")
        if sr and rp:
            abs_path = f"{sr}/{rp}"
    if abs_path == "":
        return "failed", "missing_absolute_path", {}

    path = Path(abs_path)
    if not path.is_file():
        return "failed", "document_file_missing", {}

    segments = extract_text_segments(path, mime)
    if not segments:
        return "failed", "no_extractable_text_for_graph", {}

    batch_chars = max(2000, min(12000, int(_env("OAAO_VAULT_GRAPH_BATCH_CHARS", "5500") or "5500")))
    max_batches = max(1, min(64, int(_env("OAAO_VAULT_GRAPH_MAX_BATCHES", "24") or "24")))
    batches = _segment_batches(segments, max_chars=batch_chars)[:max_batches]
    if not batches:
        return "failed", "no_graph_batches", {}

    if not await ensure_graph_schema(client, arango_cfg):
        return "failed", "arango_schema_failed", {}

    await delete_document_graph(client, arango_cfg, vault_id=vault_id, document_id=document_id)

    total_entities = 0
    total_edges = 0
    for label, body, seg_meta in batches:
        entities, relations, err = await _llm_extract_graph(
            client,
            text=body,
            segment_label=label,
            graph_cfg=graph_cfg,
        )
        if err and not entities:
            logger.warning("vault_graph_index: LLM batch failed — %s", err)
            continue
        page = seg_meta.get("page") if isinstance(seg_meta.get("page"), int) else None
        for ent in entities:
            if page and not ent.get("page"):
                ent["page"] = page
        ec, rc = await upsert_graph_batch(
            client,
            arango_cfg,
            vault_id=vault_id,
            document_id=document_id,
            entities=entities,
            relations=relations,
            segment_label=label,
        )
        total_entities += ec
        total_edges += rc

    if total_entities < 1:
        return "failed", "graph_index_no_entities_extracted", {}

    logger.info(
        "vault_graph_index: vault=%s doc=%s entities=%s edges=%s batches=%s",
        vault_id,
        document_id,
        total_entities,
        total_edges,
        len(batches),
    )
    return "completed", None, {"usage": {"entities": total_entities, "edges": total_edges, "batches": len(batches)}}
