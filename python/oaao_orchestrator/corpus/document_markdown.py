"""CS-1-S15 — Layout-aware document Markdown ingest (LLM-first, rules fallback).

Primary analyze input should be structured Markdown (headings, tables), not flat pypdf text.
When ``llm_cfg`` is configured, use the tenant's model (including LoRA-bound endpoints via
``oaao_endpoint``) to structure extracted plain text. Regex segmentation must not be the
only structure signal (see docs/reports/Intelligence-vs-Hardcode-Audit.md).
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

import httpx

from oaao_orchestrator.corpus.llm import chat_completion_text
from oaao_orchestrator.vault_document_embed import _extract_document_text_flat_fallback
from oaao_orchestrator.vault_document_extract import TextSegment, extract_text_segments

logger = logging.getLogger(__name__)

INGEST_VERSION = 1
_MAX_LLM_INPUT_CHARS = 48_000
_MAX_MARKDOWN_STORE_CHARS = 120_000

_PAGE_BREAK_MARKERS = (
    re.compile(r"^---\s*page\s+\d+\s*---\s*$", re.I | re.M),
    re.compile(r"^<!--\s*page:\s*\d+\s*-->\s*$", re.I | re.M),
)


def _segments_to_plain_text(segments: list[TextSegment]) -> str:
    parts: list[str] = []
    for seg in segments:
        body = (seg.body or "").strip()
        if not body:
            continue
        label = (seg.label or seg.scope or "").strip()
        if label and label.lower() not in ("document", "plain"):
            parts.append(f"--- {label} ---\n{body}")
        else:
            parts.append(body)
    return "\n\n".join(parts)


def extract_plain_text_from_path(path: Path, mime_type: str) -> tuple[str, str]:
    """
    Read source bytes as plain text (existing vault extract stack).
    Returns (text, extract_method).
    """
    flat = _extract_document_text_flat_fallback(str(path), mime_type)
    if flat and flat.strip():
        return flat.strip(), "flat_fallback"

    segments = extract_text_segments(path, mime_type)
    if segments:
        return _segments_to_plain_text(segments), "page_segments"

    if path.suffix.lower() in {".md", ".markdown", ".txt", ".csv", ".json", ".log"}:
        try:
            return path.read_text(encoding="utf-8", errors="replace").strip(), "utf8_file"
        except OSError:
            return "", "unreadable"

    return "", "unreadable"


def _heuristic_plain_to_markdown(plain: str, *, source_label: str) -> str:
    """Deterministic fallback: page breaks → headings, light table line grouping."""
    raw = (plain or "").replace("\r\n", "\n").strip()
    if not raw:
        return ""

    for pat in _PAGE_BREAK_MARKERS:
        raw = pat.sub("\n\n", raw)

    blocks = re.split(r"\n{2,}", raw)
    out: list[str] = []
    if source_label:
        out.append(f"# Source: {source_label}\n")

    for block in blocks:
        block = block.strip()
        if not block:
            continue
        lines = [ln.rstrip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        if len(lines) == 1:
            line = lines[0]
            if re.match(r"^#{1,6}\s", line):
                out.append(line)
            elif len(line) < 72 and not line.endswith(("。", "，", ".", ",")):
                out.append(f"## {line}")
            else:
                out.append(line)
            continue
        if _looks_like_table_block(lines):
            out.append(_lines_to_markdown_table(lines))
            continue
        if len(lines[0]) < 80 and sum(1 for ln in lines[1:] if len(ln) > 40) >= 2:
            out.append(f"## {lines[0]}\n\n" + "\n\n".join(lines[1:]))
        else:
            out.append("\n\n".join(lines))
        out.append("")

    return "\n".join(out).strip()


def _looks_like_table_block(lines: list[str]) -> bool:
    if len(lines) < 2:
        return False
    tab_rows = sum(1 for ln in lines if "\t" in ln)
    if tab_rows >= 2:
        return True
    numeric_start = sum(1 for ln in lines if re.match(r"^\d{2,4}(?:\s+|\t)", ln))
    return numeric_start >= 2 and numeric_start >= len(lines) // 3


def _lines_to_markdown_table(lines: list[str]) -> str:
    rows: list[list[str]] = []
    for ln in lines:
        if "\t" in ln:
            cells = [c.strip() for c in ln.split("\t")]
        else:
            cells = [ln.strip()]
        rows.append(cells)
    if not rows:
        return "\n".join(lines)
    width = max(len(r) for r in rows)
    norm: list[list[str]] = []
    for r in rows:
        padded = r + [""] * (width - len(r))
        norm.append(padded[:width])
    header = norm[0]
    body = norm[1:] if len(norm) > 1 else []
    parts = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for r in body:
        parts.append("| " + " | ".join(r) + " |")
    return "\n".join(parts)


async def llm_structure_to_markdown(
    client: httpx.AsyncClient,
    *,
    llm_cfg: dict[str, Any],
    plain_text: str,
    source_label: str,
) -> str | None:
    """Use configured LLM (incl. fine-tuned endpoint) to emit GitHub-flavored Markdown."""
    sample = plain_text[:_MAX_LLM_INPUT_CHARS]
    system = (
        "You convert extracted document text into clean GitHub-flavored Markdown for downstream AI. "
        "Preserve semantic structure: use #/## headings, markdown tables (| col |), blockquotes for "
        "letter intros, numbered lists only when source uses numbers. "
        "Remove page numbers, repeated headers/footers, and watermarks. "
        "Do not invent facts. Traditional Chinese content stays Chinese. "
        "Output ONLY markdown — no JSON, no code fences wrapping the whole doc."
    )
    user = (
        f"Source label: {source_label or 'document'}\n\n"
        f"Extracted plain text:\n{sample}"
    )
    md = await chat_completion_text(
        client,
        llm_cfg=llm_cfg,
        system=system,
        user=user,
        temperature=0.15,
        timeout_sec=120.0,
    )
    if not md:
        return None
    cleaned = md.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:markdown|md)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip() or None


def ingest_mode_from_env() -> str:
    """``llm`` (default when cfg present), ``heuristic``, or ``off`` (use raw plain only)."""
    return (os.environ.get("OAAO_CORPUS_MARKDOWN_INGEST") or "llm").strip().lower()


async def build_document_markdown(
    *,
    path: Path | None = None,
    mime_type: str = "",
    plain_text: str | None = None,
    source_label: str = "",
    llm_cfg: dict[str, Any] | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """
    CS-1-S15 entry: produce ``document_markdown`` artifact for analyze.

    Returns dict with keys: version, markdown, method, extract_method, char_count, truncated.
    """
    extract_method = "inline"
    if plain_text is None:
        if path is None:
            return {
                "version": INGEST_VERSION,
                "markdown": "",
                "method": "empty",
                "extract_method": "missing",
                "char_count": 0,
                "truncated": False,
            }
        plain_text, extract_method = extract_plain_text_from_path(path, mime_type)

    plain = (plain_text or "").strip()
    if not plain:
        return {
            "version": INGEST_VERSION,
            "markdown": "",
            "method": "empty",
            "extract_method": extract_method,
            "char_count": 0,
            "truncated": False,
        }

    mode = ingest_mode_from_env()
    method = "heuristic"
    markdown = ""

    use_llm = (
        mode == "llm"
        and isinstance(llm_cfg, dict)
        and str(llm_cfg.get("base_url") or "").strip()
        and str(llm_cfg.get("model") or "").strip()
    )

    if use_llm:
        own_client = client is None
        if own_client:
            client = httpx.AsyncClient()
        try:
            assert client is not None
            llm_md = await llm_structure_to_markdown(
                client,
                llm_cfg=llm_cfg or {},
                plain_text=plain,
                source_label=source_label,
            )
            if llm_md:
                markdown = llm_md
                method = "llm"
        except Exception as exc:  # noqa: BLE001
            logger.warning("corpus document_markdown llm failed: %s", exc)
        finally:
            if own_client and client is not None:
                await client.aclose()

    if not markdown and mode != "off":
        markdown = _heuristic_plain_to_markdown(plain, source_label=source_label)
        method = "heuristic" if method != "llm" else "heuristic_fallback"

    if mode == "off" or not markdown:
        markdown = plain
        method = "plain" if mode == "off" else "plain_fallback"

    truncated = False
    if len(markdown) > _MAX_MARKDOWN_STORE_CHARS:
        markdown = markdown[:_MAX_MARKDOWN_STORE_CHARS]
        truncated = True

    return {
        "version": INGEST_VERSION,
        "markdown": markdown,
        "method": method,
        "extract_method": extract_method,
        "char_count": len(markdown),
        "truncated": truncated,
    }


def merge_document_markdown_meta(
    meta: dict[str, Any],
    *,
    per_source: list[dict[str, Any]],
    combined_markdown: str,
    combined_method: str,
) -> None:
    """Attach S15 artifacts to style_json.meta (preview + per-source summary)."""
    meta["document_markdown_version"] = INGEST_VERSION
    meta["document_markdown_method"] = combined_method
    meta["document_markdown_chars"] = len(combined_markdown)
    meta["document_markdown_preview"] = combined_markdown[:4000]
    meta["document_ingest_by_source"] = per_source
    if len(combined_markdown) <= _MAX_MARKDOWN_STORE_CHARS:
        meta["document_markdown"] = combined_markdown
