"""Orchestrator worker: persist vault document text chunks into Qdrant (`vh.rag.document_embed` jobs)."""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import Any

import httpx

from oaao_orchestrator.vault_document_extract import (
    TextSegment,
    build_asr_segment_pieces,
    build_embedding_pieces,
    extract_text_segments,
)
from oaao_orchestrator.vault_graph_rag import (
    _env,
    ensure_url_scheme,
    openai_compat_embed_batch,
    openai_compat_embeddings_url_from_base,
)

logger = logging.getLogger(__name__)


def _resolve_secret(env_name: str | None) -> str | None:
    if not env_name:
        return None
    v = os.environ.get(env_name.strip())
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def _stable_point_uuid(vault_id: int, document_id: int, chunk_idx: int) -> str:
    ns = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # fixed namespace UUID
    return str(uuid.uuid5(ns, f"oaao_vault|{vault_id}|{document_id}|{chunk_idx}"))


def _read_text_plain(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            return path.read_text(encoding="latin-1", errors="replace")
        except Exception:  # noqa: BLE001
            return None
    except Exception:  # noqa: BLE001
        return None


def _extract_document_text_flat_fallback(abs_path: str, mime_type: str) -> str | None:
    path = Path(abs_path)
    if not path.is_file():
        return None
    mime = (mime_type or "").lower().strip()
    if mime == "application/pdf" or str(path).lower().endswith(".pdf"):
        segments = extract_text_segments(path, mime)
        if segments:
            parts = [s.body.strip() for s in segments if (s.body or "").strip()]
            return "\n".join(parts) if parts else None
        return None

    if mime.startswith("text/") or mime in ("application/json",) or mime.endswith("+json"):
        out = _read_text_plain(path)
        return out.strip() if out else None

    # Best-effort: treat unknown as UTF-8 text (small configs, markdown without correct mime)
    if path.suffix.lower() in {".md", ".txt", ".csv", ".log", ".json"}:
        out = _read_text_plain(path)
        return out.strip() if out else None

    return None


_AUDIO_EXTENSIONS = frozenset({"mp3", "m4a", "wav", "ogg", "webm", "flac", "aac", "opus", "wma"})


def _is_audio_file(mime_type: str, path: Path, original_name: str = "") -> bool:
    mime = (mime_type or "").lower().strip()
    if mime.startswith("audio/"):
        return True
    for name in (original_name, path.name):
        if not name:
            continue
        ext = Path(name).suffix.lstrip(".").lower()
        if ext in _AUDIO_EXTENSIONS:
            return True
    return False


async def _qdrant_collection_exists(
    client: httpx.AsyncClient, base_url: str, collection: str, api_key: str | None
) -> bool:
    bu = base_url.rstrip("/")
    headers = _qdrant_headers(api_key)
    r = await client.get(
        f"{bu}/collections/{collection}", headers=headers, timeout=httpx.Timeout(30.0, connect=12.0)
    )
    return bool(r.status_code == 200)


async def _qdrant_create_collection(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    collection: str,
    vector_size: int,
    api_key: str | None,
) -> bool:
    bu = base_url.rstrip("/")
    headers = _qdrant_headers(api_key)
    body: dict[str, Any] = {
        "vectors": {
            "size": vector_size,
            "distance": "Cosine",
        },
    }
    r = await client.put(
        f"{bu}/collections/{collection}",
        headers=headers,
        json=body,
        timeout=httpx.Timeout(60.0, connect=12.0),
    )
    return bool(r.status_code in (200, 201))


def _qdrant_headers(api_key: str | None) -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if api_key:
        h["api-key"] = api_key
    return h


async def _qdrant_delete_embeddings_for_document(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    collection: str,
    api_key: str | None,
    vault_id: int,
    document_id: int,
) -> None:
    """Best-effort: remove stale chunk points before upsert (re-ingest fewer chunks orphan cleanup)."""

    try:
        bu = ensure_url_scheme(base_url.strip()).rstrip("/")
        if not bu:
            return
        headers = _qdrant_headers(api_key)
        body: dict[str, Any] = {
            "filter": {
                "must": [
                    {"key": "vault_id", "match": {"value": int(vault_id)}},
                    {"key": "document_id", "match": {"value": int(document_id)}},
                ],
            },
            "wait": True,
        }
        url = f"{bu}/collections/{collection}/points/delete"
        r = await client.post(
            url,
            headers=headers,
            json=body,
            timeout=httpx.Timeout(90.0, connect=12.0),
        )
        if r.status_code >= 400:
            logger.warning(
                "vault_document_embed: qdrant delete HTTP %s — %s",
                r.status_code,
                (r.text or "")[:400],
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("vault_document_embed: qdrant delete failed — %s", e)


async def _qdrant_upsert_points(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    collection: str,
    api_key: str | None,
    vault_id: int,
    document_id: int,
    chunk_rows: list[tuple[int, list[float], str, dict[str, Any]]],
    file_name: str = "",
) -> bool:
    if not chunk_rows:
        return True
    bu = base_url.rstrip("/")
    headers = _qdrant_headers(api_key)
    url = f"{bu}/collections/{collection}/points?wait=true"

    batch = 48
    for off in range(0, len(chunk_rows), batch):
        slice_ = chunk_rows[off : off + batch]
        points: list[dict[str, Any]] = []
        for idx, vector, snippet, extra in slice_:
            payload: dict[str, Any] = {
                "vault_id": int(vault_id),
                "document_id": int(document_id),
                "chunk_index": idx,
                "text": snippet[:32000],
            }
            if file_name:
                payload["file_name"] = file_name[:255]
            if extra:
                for k, v in extra.items():
                    if v is not None and v != "":
                        payload[str(k)] = v
            points.append(
                {
                    "id": _stable_point_uuid(vault_id, document_id, idx),
                    "vector": vector,
                    "payload": payload,
                }
            )
        r = await client.put(
            url,
            headers=headers,
            json={"points": points},
            timeout=httpx.Timeout(120.0, connect=15.0),
        )
        if r.status_code >= 400:
            logger.warning(
                "vault_document_embed: qdrant upsert HTTP %s — %s", r.status_code, r.text[:500]
            )
            return False
    return True


async def process_vault_document_embed(
    client: httpx.AsyncClient, job: dict[str, Any]
) -> tuple[str, str | None, dict[str, Any]]:
    """
    Embed one claimed job.

    Returns (``completed``|``failed``, error_message_or_none).

    Preconditions: merged job payload from PHP (`oaao_vault_merge_graphrag_job_payload`) with GraphRAG / Qdrant targets.
    """
    jid_raw = job.get("job_id")
    hook = str(job.get("hook_id") or "")
    if hook != "vh.rag.document_embed":
        return "failed", f"unsupported_hook:{hook}", {}

    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    vault_id_raw = payload.get("vault_id") if isinstance(payload, dict) else job.get("vault_id")
    doc_id_raw = payload.get("document_id") if isinstance(payload, dict) else job.get("document_id")
    vault_id = int(vault_id_raw) if vault_id_raw is not None else 0
    document_id = int(doc_id_raw) if doc_id_raw is not None else 0
    if vault_id < 1 or document_id < 1:
        return "failed", "missing_vault_or_document_id", {}

    mime = str((payload.get("mime_type") if isinstance(payload, dict) else "") or "").strip()
    abs_path = str(job.get("absolute_path") or "").strip()
    if abs_path == "" and isinstance(payload, dict):
        sr = str(payload.get("storage_root") or "").rstrip("/")
        rp = str(payload.get("relative_path") or "").lstrip("/")
        if sr and rp:
            abs_path = f"{sr}/{rp}"
    if abs_path == "":
        return "failed", "missing_absolute_path", {}

    graphrag = payload.get("graphrag") if isinstance(payload.get("graphrag"), dict) else {}
    qinfo = graphrag.get("qdrant") if isinstance(graphrag.get("qdrant"), dict) else {}
    default_q = _env("OAAO_QDRANT_URL", "http://qdrant:6333").rstrip("/")
    q_url = str(qinfo.get("url") or "").strip() or default_q
    q_col = str(payload.get("qdrant_collection") if isinstance(payload, dict) else "").strip()
    if not q_col:
        q_col = str(qinfo.get("collection") or "").strip()
    if not q_col:
        fb = (_env("OAAO_QDRANT_DEFAULT_COLLECTION", "") or "").strip()
        if fb:
            q_col = fb
    if not q_col:
        return "failed", "vault_missing_qdrant_collection", {}

    api_key_env = qinfo.get("api_key_env")
    q_key = None
    if isinstance(api_key_env, str) and api_key_env.strip():
        q_key = _resolve_secret(api_key_env.strip())

    emb_cfg = graphrag.get("embedding") if isinstance(graphrag.get("embedding"), dict) else {}
    mo = str(emb_cfg.get("model") or "").strip()
    url_direct = str(emb_cfg.get("url") or "").strip()
    bu = str(emb_cfg.get("base_url") or "").strip()
    if not mo:
        return "failed", "vault_embed_missing_embedding_model_configure_embedding_purpose", {}
    if not url_direct and not bu:
        return "failed", "vault_embed_missing_embedding_purpose_endpoint", {}

    embed_url_final = (
        ensure_url_scheme(url_direct) if url_direct else openai_compat_embeddings_url_from_base(bu)
    )

    ek: str | None = None
    ake = emb_cfg.get("api_key_env")
    if isinstance(ake, str) and ake.strip():
        ek = _resolve_secret(ake.strip())

    embed_target = embed_url_final.lower()
    if not ek and "api.openai.com" in embed_target:
        logger.warning(
            "vault_document_embed: OpenAI embeddings URL but endpoint has no api_key_ref (env:name) — expect 401",
        )

    path = Path(abs_path)
    doc_file_name = (path.name or "").strip()[:255]
    source_text_raw = payload.get("source_text") if isinstance(payload, dict) else None
    source_text = source_text_raw.strip() if isinstance(source_text_raw, str) else ""
    summary_text_raw = payload.get("embed_summary_text") if isinstance(payload, dict) else None
    summary_text = summary_text_raw.strip() if isinstance(summary_text_raw, str) else ""
    summary_label_raw = payload.get("embed_summary_label") if isinstance(payload, dict) else None
    summary_label = summary_label_raw.strip() if isinstance(summary_label_raw, str) else "Summary"
    summary_meta = (
        payload.get("embed_summary_meta")
        if isinstance(payload.get("embed_summary_meta"), dict)
        else {}
    )
    original_name_raw = payload.get("original_name") if isinstance(payload, dict) else None
    original_name = original_name_raw.strip() if isinstance(original_name_raw, str) else ""
    mime_l = (mime or "").lower()
    is_audio = _is_audio_file(mime, path, original_name)

    asr_segments_raw = payload.get("asr_segments") if isinstance(payload, dict) else None
    asr_segments: list[dict[str, Any]] = []
    if isinstance(asr_segments_raw, list):
        for item in asr_segments_raw:
            if isinstance(item, dict) and str(item.get("text") or "").strip():
                asr_segments.append(item)

    segments: list[TextSegment] = []
    if summary_text:
        seg_meta: dict[str, Any] = {"from_transcript_summary": True}
        if isinstance(summary_meta, dict):
            for k, v in summary_meta.items():
                if v is not None and v != "":
                    seg_meta[str(k)] = v
        segments.append(
            TextSegment(
                scope="transcript_summary",
                label=summary_label or "Summary",
                body=summary_text,
                meta=seg_meta,
            ),
        )
    use_asr_segment_chunks = len(asr_segments) > 0
    if source_text and not use_asr_segment_chunks:
        segments.append(
            TextSegment(
                scope="plain",
                label=(path.name or "transcript"),
                body=source_text,
                meta={"from_asr": True},
            ),
        )
    elif not segments and not use_asr_segment_chunks:
        if is_audio:
            return "failed", "audio_requires_asr", {}
        extracted = extract_text_segments(path, mime)
        if extracted:
            segments = extracted
        else:
            flat = _extract_document_text_flat_fallback(abs_path, mime)
            segments = (
                [TextSegment(scope="plain", label=(path.name or "document"), body=flat, meta={})]
                if (flat or "").strip()
                else []
            )

    chunk_size = max(512, min(12000, int(_env("OAAO_VAULT_INGEST_CHUNK_SIZE", "2800") or "2800")))
    overlap = max(
        0, min(chunk_size // 2, int(_env("OAAO_VAULT_INGEST_CHUNK_OVERLAP", "260") or "260"))
    )
    max_chunks = max(1, min(5000, int(_env("OAAO_VAULT_INGEST_MAX_CHUNKS", "500") or "500")))
    pieces_meta: list[tuple[str, dict[str, Any]]] = []
    if segments:
        pieces_meta = build_embedding_pieces(
            segments, chunk_size=chunk_size, overlap=overlap, max_chunks=max_chunks
        )
    if use_asr_segment_chunks:
        asr_pieces = build_asr_segment_pieces(
            asr_segments, chunk_size=chunk_size, max_chunks=max_chunks - len(pieces_meta)
        )
        pieces_meta.extend(asr_pieces)
    if not pieces_meta:
        if is_audio:
            return "failed", "audio_requires_asr", {}
        reason = (
            "no_extractable_text (supported: OOXML docs, text/markdown/pdf/json, plaintext — install python-docx, openpyxl, python-pptx, pypdf)"
            if mime_l
            and (
                "spreadsheetml" in mime_l
                or "presentationml" in mime_l
                or "wordprocessingml" in mime_l
            )
            else "no_extractable_text"
        )
        return "failed", reason, {}

    await _qdrant_delete_embeddings_for_document(
        client,
        base_url=q_url,
        collection=q_col,
        api_key=q_key,
        vault_id=vault_id,
        document_id=document_id,
    )

    batch_size = max(1, min(256, int(_env("OAAO_VAULT_EMBED_BATCH_SIZE", "48") or "48")))
    embeddings: list[tuple[int, list[float], str, dict[str, Any]]] = []
    texts_only = [t for t, _ in pieces_meta]
    for batch_start in range(0, len(texts_only), batch_size):
        batch = texts_only[batch_start : batch_start + batch_size]
        vecs, embed_err = await openai_compat_embed_batch(
            client,
            batch,
            ek,
            url=embed_url_final,
            model=mo,
        )
        if not vecs or len(vecs) != len(batch):
            detail = embed_err or "unknown"
            msg = f"embedding_failed_at_batch:{batch_start}:{detail}"
            return "failed", msg[:4000], {}
        for off, vec in enumerate(vecs):
            idx = batch_start + off
            snippet, chunk_meta = pieces_meta[idx]
            embeddings.append((idx, vec, snippet, chunk_meta))

    vector_size = len(embeddings[0][1])

    exists = await _qdrant_collection_exists(client, q_url, q_col, q_key)
    if not exists:
        ok_c = await _qdrant_create_collection(
            client, base_url=q_url, collection=q_col, vector_size=vector_size, api_key=q_key
        )
        if not ok_c:
            return "failed", "qdrant_create_collection_failed", {}

    ok_up = await _qdrant_upsert_points(
        client,
        base_url=q_url,
        collection=q_col,
        api_key=q_key,
        vault_id=vault_id,
        document_id=document_id,
        chunk_rows=embeddings,
        file_name=doc_file_name,
    )
    if not ok_up:
        return "failed", "qdrant_upsert_failed", {}

    logger.info(
        "vault_document_embed: job=%s vault=%s doc=%s chunks=%s batch_size=%s collection=%s",
        jid_raw,
        vault_id,
        document_id,
        len(embeddings),
        batch_size,
        q_col,
    )
    return "completed", None, {"usage": {"chunks": len(embeddings)}}
