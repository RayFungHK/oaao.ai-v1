"""CS-2-S3 — text / office files → library blocks JSON."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from oaao_orchestrator.vault_document_extract import extract_text_segments


def text_to_blocks(text: str, *, title: str = "Untitled") -> list[dict[str, Any]]:
    """Split plain text into paragraph blocks (fallback when no office extractor)."""
    blocks: list[dict[str, Any]] = []
    raw = (text or "").strip()
    if not raw:
        return [{"id": "b1", "type": "paragraph", "content": ""}]
    for i, para in enumerate(raw.split("\n\n")[:48]):
        chunk = para.strip()
        if not chunk:
            continue
        blocks.append({"id": f"b{i + 1}", "type": "paragraph", "content": chunk})
    if not blocks:
        blocks.append({"id": "b1", "type": "paragraph", "content": ""})
    return blocks


def segments_to_blocks(segments: list[Any], *, title: str = "Untitled") -> list[dict[str, Any]]:
    """Map vault extract segments to library block types."""
    blocks: list[dict[str, Any]] = []
    idx = 0
    for seg in segments:
        body = str(getattr(seg, "body", "") or "").strip()
        if not body:
            continue
        label = str(getattr(seg, "label", "") or "").strip()
        scope = str(getattr(seg, "scope", "") or "").strip().lower()
        idx += 1
        btype = "paragraph"
        level = 1
        if scope == "heading" or (label and len(label) < 120 and "\n" not in label):
            btype = "heading"
            level = 2 if scope == "heading" else 1
        first_line = body.split("\n", 1)[0].strip()
        if first_line.startswith("# "):
            btype = "heading"
            level = 1
            body = body.lstrip("# ").strip()
        elif first_line.startswith("## "):
            btype = "heading"
            level = 2
            body = body.lstrip("#").strip()
        blocks.append(
            {
                "id": f"b{idx}",
                "type": btype,
                "content": body,
                **({"level": level} if btype == "heading" else {}),
            },
        )
    if not blocks:
        return text_to_blocks("", title=title)
    return blocks[:64]


def convert_payload_to_blocks(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], str, str]:
    """
    Returns (blocks, markdown_mirror, status).
    status: text | file_extract | stub_convert
    """
    title = str(payload.get("title") or "Untitled").strip() or "Untitled"
    text = str(payload.get("text") or payload.get("source_text") or "").strip()
    abs_path = str(payload.get("absolute_path") or "").strip()
    mime = str(payload.get("mime_type") or "application/octet-stream").strip()

    if abs_path:
        path = Path(abs_path)
        if path.is_file():
            segments = extract_text_segments(path, mime)
            if segments:
                md_parts = [str(getattr(s, "body", "") or "").strip() for s in segments]
                md_parts = [p for p in md_parts if p]
                markdown = "\n\n".join(md_parts)
                return segments_to_blocks(segments, title=title), markdown, "file_extract"

    if text:
        return text_to_blocks(text, title=title), text, "text"

    return text_to_blocks("", title=title), "", "stub_convert"
