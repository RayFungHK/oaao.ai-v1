"""Corpus Studio analyze worker — extract text, segment, derive style_json v1."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import httpx

from oaao_orchestrator.corpus.llm import extract_style_json_llm, merge_style_json, refine_segment_kinds_llm
from oaao_orchestrator.corpus.document_markdown import (
    build_document_markdown,
    merge_document_markdown_meta,
)
from oaao_orchestrator.corpus.extraction import attach_extraction_meta, run_two_stage_extraction
from oaao_orchestrator.corpus.schema_registry import (
    attach_document_type_meta,
    classify_document,
    load_schema_registry,
)
from oaao_orchestrator.corpus.segmenting import segment_kind_summary
from oaao_orchestrator.corpus.html_template import (
    attach_html_template_to_style_json,
    build_html_template_v1,
)
from oaao_orchestrator.corpus.structure import (
    build_structure_blueprint,
    fingerprint_from_segments,
    score_sources_vs_corpus,
)
from oaao_orchestrator.corpus.segmenting import segment_analyze_text
from oaao_orchestrator.vault_document_embed import _extract_document_text_flat_fallback
from oaao_orchestrator.vault_document_extract import TextSegment, extract_text_segments

_SEGMENT_CAP_DEFAULT = 500
_CHUNK_CHARS = 1800


def _resolve_source_path(item: dict[str, Any], payload: dict[str, Any] | None = None) -> Path | None:
    payload = payload or {}
    candidates: list[Path] = []

    raw = str(item.get("absolute_path") or "").strip()
    if raw:
        candidates.append(Path(raw))

    rel = str(item.get("relative_path") or "").strip().lstrip("/")
    loc = item.get("storage_locator")
    if isinstance(loc, dict):
        if not rel:
            rel = str(loc.get("key") or "").strip().lstrip("/")

    root = str(payload.get("corpus_storage_root") or "").strip()
    if not root:
        root = os.environ.get("OAAO_CORPUS_STORAGE", "").strip()
    if not root and isinstance(loc, dict):
        root = str(loc.get("local_root") or "").strip()
    if root and rel:
        candidates.append(Path(root) / rel)

    if isinstance(loc, dict):
        lr = str(loc.get("local_root") or "").strip()
        key = str(loc.get("key") or rel or "").strip().lstrip("/")
        if lr and key:
            candidates.append(Path(lr) / key)

    seen: set[str] = set()
    for p in candidates:
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        if p.is_file():
            return p
    return None


def _read_source_text(item: dict[str, Any], payload: dict[str, Any] | None = None) -> str:
    inline = item.get("source_text")
    if isinstance(inline, str) and inline.strip():
        return inline.strip()

    p = _resolve_source_path(item, payload)
    if p is None:
        return ""

    mime = str(item.get("mime_type") or "").strip()
    name = str(item.get("file_name") or item.get("label") or p.name)
    flat = _extract_document_text_flat_fallback(str(p), mime)
    if flat and flat.strip():
        return flat.strip()

    segments = extract_text_segments(p, mime)
    if segments:
        parts = [s.body.strip() for s in segments if (s.body or "").strip()]
        return "\n\n".join(parts) if parts else ""

    if p.suffix.lower() in {".md", ".txt", ".csv", ".json", ".log"}:
        try:
            return p.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            return ""

    return ""


def _classify_excerpt(text: str) -> dict[str, Any]:
    sample = text[:800].lower()
    lang = "zh" if re.search(r"[\u4e00-\u9fff]", sample) else "en"
    genre = "technical" if re.search(r"\b(api|function|class|def |import )\b", sample) else "general"
    tone = "formal" if re.search(r"\b(shall|must|therefore|accordingly)\b", sample) else "neutral"

    return {
        "genre": genre,
        "audience": "general",
        "tone": tone,
        "language": lang,
        "domain": "unknown",
    }


def _derive_style_json(all_text: str, segment_count: int) -> dict[str, Any]:
    lines = [ln.strip() for ln in all_text.splitlines() if ln.strip()]
    heading_style = "sentence_case"
    if any(ln.startswith("#") for ln in lines[:40]):
        heading_style = "markdown_headings"
    elif sum(1 for ln in lines[:40] if len(ln) < 80 and ln == ln.upper()) >= 2:
        heading_style = "all_caps_short"

    list_style = "bullet"
    if re.search(r"^\s*\d+[\.)]\s", all_text, re.MULTILINE):
        list_style = "numbered"

    return {
        "version": 1,
        "structure": {
            "sections": [],
            "heading_style": heading_style,
        },
        "lexicon": {"preferred_terms": [], "avoid_terms": []},
        "formatting": {"list_style": list_style, "citation_style": ""},
        "tone": _classify_excerpt(all_text[:1200])["tone"],
        "dos": ["Match source paragraph rhythm", "Preserve list patterns where present"],
        "donts": ["Do not invent facts not present in sources"],
        "meta": {"segment_count": segment_count},
    }


async def run_corpus_analyze(payload: dict[str, Any]) -> dict[str, Any]:
    corpus_id = int(payload.get("corpus_id") or 0)
    if corpus_id < 1:
        return {"ok": False, "error": "corpus_id_required"}

    cap = int(payload.get("segment_cap") or _SEGMENT_CAP_DEFAULT)
    cap = max(1, min(500, cap))

    sources = payload.get("sources")
    if not isinstance(sources, list) or not sources:
        return {"ok": False, "error": "sources_required"}

    segments_out: list[dict[str, Any]] = []
    per_source_segments: dict[int, list[dict[str, Any]]] = {}
    source_labels: dict[int, str] = {}
    all_text_parts: list[str] = []
    document_ingest_rows: list[dict[str, Any]] = []
    ordinal = 0
    llm_cfg = payload.get("llm_cfg") if isinstance(payload.get("llm_cfg"), dict) else None

    async with httpx.AsyncClient() as md_client:
        for src in sources:
            if not isinstance(src, dict):
                continue
            source_id = src.get("source_id")
            try:
                sid = int(source_id) if source_id is not None else None
            except (TypeError, ValueError):
                sid = None
            if sid is not None and sid > 0:
                source_labels[sid] = str(src.get("label") or src.get("file_name") or f"source_{sid}")

            label = source_labels.get(sid, f"source_{sid}") if sid else str(
                src.get("label") or src.get("file_name") or "source"
            )
            inline = src.get("source_text")
            if isinstance(inline, str) and inline.strip():
                dm = await build_document_markdown(
                    plain_text=inline.strip(),
                    source_label=label,
                    llm_cfg=llm_cfg,
                    client=md_client,
                )
            else:
                p = _resolve_source_path(src, payload)
                if p is None:
                    continue
                mime = str(src.get("mime_type") or "").strip()
                dm = await build_document_markdown(
                    path=p,
                    mime_type=mime,
                    source_label=label,
                    llm_cfg=llm_cfg,
                    client=md_client,
                )

            text = str(dm.get("markdown") or "").strip()
            if not text:
                continue

            document_ingest_rows.append(
                {
                    "source_id": sid,
                    "label": label,
                    "method": dm.get("method"),
                    "extract_method": dm.get("extract_method"),
                    "char_count": dm.get("char_count"),
                    "truncated": bool(dm.get("truncated")),
                }
            )
            all_text_parts.append(text)
            for chunk, classify in segment_analyze_text(text, max_chars=_CHUNK_CHARS):
                if ordinal >= cap:
                    break
                row = {
                    "text": chunk,
                    "classify_json": classify,
                    "source_id": sid,
                    "ordinal": ordinal,
                }
                segments_out.append(row)
                if sid is not None and sid > 0:
                    per_source_segments.setdefault(sid, []).append(row)
                ordinal += 1
            if ordinal >= cap:
                break

    if not segments_out:
        hints: list[str] = []
        for src in sources:
            if not isinstance(src, dict):
                continue
            p = _resolve_source_path(src, payload)
            label = str(src.get("label") or src.get("file_name") or "source")
            if p is None:
                tried = str(src.get("absolute_path") or src.get("relative_path") or "").strip()
                hints.append(f"{label}: file not found ({tried or 'no path'})")
            else:
                hints.append(f"{label}: unreadable or empty ({p.name})")
        detail = "; ".join(hints[:6]) if hints else "no text extracted from any source"
        return {"ok": False, "error": "no_extractable_text", "detail": detail}

    merged = "\n\n".join(all_text_parts)[:120_000]
    profile_name = str(payload.get("profile_name") or "")
    schema_registry = load_schema_registry()

    classification = await classify_document(
        markdown=merged,
        llm_cfg=llm_cfg,
        profile_name=profile_name,
    )

    heuristic_style = _derive_style_json(merged, len(segments_out))
    llm_style = None
    if isinstance(llm_cfg, dict) and llm_cfg.get("base_url") and llm_cfg.get("model"):
        async with httpx.AsyncClient() as client:
            await refine_segment_kinds_llm(client, llm_cfg=llm_cfg, segments=segments_out)
            llm_style = await extract_style_json_llm(
                client,
                llm_cfg=llm_cfg,
                profile_name=profile_name,
                segments=segments_out,
            )
    style = merge_style_json(heuristic_style, llm_style, segment_count=len(segments_out))
    kinds = segment_kind_summary(segments_out)
    corpus_fp = fingerprint_from_segments(segments_out)
    blueprint = build_structure_blueprint(segments_out)
    per_source_rows: list[dict[str, Any]] = []
    for sid, segs in per_source_segments.items():
        per_source_rows.append(
            {
                "source_id": sid,
                "label": source_labels.get(sid, f"source_{sid}"),
                "fingerprint": fingerprint_from_segments(segs),
                "segment_count": len(segs),
            }
        )
    source_structure = score_sources_vs_corpus(per_source_rows, corpus_fp)

    extraction = await run_two_stage_extraction(
        markdown=merged,
        document_type=classification.document_type,
        llm_cfg=llm_cfg,
    )

    meta = style.setdefault("meta", {})
    if isinstance(meta, dict):
        combined_md = "\n\n".join(all_text_parts)[:120_000]
        primary_method = "plain"
        if document_ingest_rows:
            methods = {str(r.get("method") or "") for r in document_ingest_rows}
            if "llm" in methods:
                primary_method = "llm"
            elif "heuristic" in methods or "heuristic_fallback" in methods:
                primary_method = "heuristic"
        merge_document_markdown_meta(
            meta,
            per_source=document_ingest_rows,
            combined_markdown=combined_md,
            combined_method=primary_method,
        )
        attach_document_type_meta(
            meta,
            classification=classification,
            registry=schema_registry,
        )
        attach_extraction_meta(meta, extraction)
        meta["segment_kinds"] = kinds
        meta["structure_blueprint"] = blueprint
        meta["corpus_fingerprint"] = corpus_fp
        outliers = [r for r in source_structure if r.get("outlier")]
        if outliers:
            meta["source_structure_warnings"] = outliers
        html_tpl = build_html_template_v1(
            segments=segments_out,
            structure_blueprint=blueprint,
            profile_name=str(payload.get("profile_name") or ""),
            document_type=classification.document_type,
            extraction=extraction.extraction,
        )
        attach_html_template_to_style_json(style, html_tpl)

    return {
        "ok": True,
        "corpus_id": corpus_id,
        "segments": segments_out,
        "style_json": style,
        "document_type": classification.document_type,
        "document_type_confidence": classification.confidence,
        "extraction": extraction.extraction,
        "extraction_partial": extraction.partial,
        "extraction_errors": extraction.validation_errors,
        "segment_kind_summary": kinds,
        "structure_blueprint": blueprint,
        "source_structure": source_structure,
        "status": "done",
    }
