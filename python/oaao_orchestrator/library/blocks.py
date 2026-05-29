"""Library block JSON → plain text chunks for embedding."""

from __future__ import annotations

import re
from typing import Any


def blocks_to_markdown(blocks: list[dict[str, Any]], *, title: str = "") -> str:
    parts: list[str] = []
    if title.strip():
        parts.append(f"# {title.strip()}\n")
    for block in blocks:
        if not isinstance(block, dict):
            continue
        btype = str(block.get("type") or "paragraph").strip().lower()
        content = str(block.get("content") or "").strip()
        if btype == "divider":
            parts.append("\n---\n")
            continue
        if not content and btype not in ("divider",):
            continue
        if btype == "heading":
            level = block.get("level")
            try:
                lvl = max(1, min(3, int(level)))
            except (TypeError, ValueError):
                lvl = 1
            parts.append(f"{'#' * lvl} {content}\n")
        elif btype == "bullet_list":
            for ln in content.splitlines() or [content]:
                ln = ln.strip()
                if ln:
                    parts.append(f"- {ln}\n")
        elif btype == "numbered_list":
            for i, ln in enumerate(content.splitlines() or [content], start=1):
                ln = ln.strip()
                if ln:
                    parts.append(f"{i}. {ln}\n")
        elif btype == "code":
            parts.append(f"```\n{content}\n```\n")
        elif btype == "table":
            rows = block.get("meta", {}).get("rows") if isinstance(block.get("meta"), dict) else None
            if isinstance(rows, list) and rows:
                header = rows[0] if isinstance(rows[0], list) else []
                lines = ["| " + " | ".join(str(c) for c in header) + " |"]
                lines.append("| " + " | ".join("---" for _ in header) + " |")
                for row in rows[1:]:
                    if isinstance(row, list):
                        lines.append("| " + " | ".join(str(c) for c in row) + " |")
                parts.append("\n".join(lines) + "\n")
            elif content:
                parts.append(f"{content}\n\n")
        else:
            parts.append(f"{content}\n\n")
    return "".join(parts).strip()


def chunk_markdown(text: str, *, chunk_size: int = 1800, overlap: int = 200) -> list[str]:
    raw = (text or "").strip()
    if not raw:
        return []
    if len(raw) <= chunk_size:
        return [raw]

    paras = [p.strip() for p in re.split(r"\n{2,}", raw) if p.strip()]
    if not paras:
        return [raw[:chunk_size]]

    chunks: list[str] = []
    buf = ""
    for para in paras:
        candidate = f"{buf}\n\n{para}".strip() if buf else para
        if len(candidate) <= chunk_size:
            buf = candidate
            continue
        if buf:
            chunks.append(buf)
        if len(para) <= chunk_size:
            buf = para
            continue
        start = 0
        while start < len(para):
            end = min(len(para), start + chunk_size)
            chunks.append(para[start:end])
            if end >= len(para):
                break
            start = max(start + 1, end - overlap)
        buf = ""
    if buf:
        chunks.append(buf)
    return chunks[:500]
