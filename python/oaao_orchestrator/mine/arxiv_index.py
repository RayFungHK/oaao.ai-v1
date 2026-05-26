"""Heuristic row extraction from arXiv list / recent HTML (no LLM)."""

from __future__ import annotations

import re
from typing import Any

from oaao_orchestrator.research.fetch import _extract_arxiv_abs_urls


def parse_arxiv_list_html(html: str, *, limit: int = 50) -> list[dict[str, Any]]:
    """Parse arXiv list/recent HTML into row dicts suitable for mine upsert."""
    rows: list[dict[str, Any]] = []
    for abs_url in _extract_arxiv_abs_urls(html, limit=limit):
        arxiv_id = abs_url.rsplit("/", 1)[-1]
        title = _title_for_arxiv_id(html, arxiv_id)
        rows.append(
            {
                "arxiv_id": arxiv_id,
                "title": title,
                "abs_url": abs_url,
            }
        )
    return rows


def _title_for_arxiv_id(html: str, arxiv_id: str) -> str:
    chunk_pat = re.compile(
        rf"arxiv:{re.escape(arxiv_id)}[\s\S]{{0,800}}?Title:\s*([^\n<]+)",
        re.I,
    )
    m = chunk_pat.search(html.replace("\r", ""))
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    return ""


def project_rows_to_schema(
    rows: list[dict[str, Any]], schema: dict[str, Any]
) -> list[dict[str, Any]]:
    """Keep only columns declared in schema; drop empty rows."""
    columns = schema.get("columns") if isinstance(schema.get("columns"), list) else []
    names = [str(c.get("name")) for c in columns if isinstance(c, dict) and c.get("name")]
    if not names:
        return rows
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        projected = {n: row.get(n) for n in names if n in row}
        if not projected:
            continue
        if all(v is None or str(v).strip() == "" for v in projected.values()):
            continue
        out.append(projected)
    return out
