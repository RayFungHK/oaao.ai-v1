"""Fetch raw payload from a mine source definition."""

from __future__ import annotations

import json
from typing import Any

import httpx

from oaao_orchestrator.mine.fetch import fetch_json, fetch_text
from oaao_orchestrator.mine.html_table import parse_html_tables
from oaao_orchestrator.mine.json_path import rows_from_json_path
from oaao_orchestrator.mine.playwright_fetch import fetch_html_playwright


def parse_csv(text: str) -> list[dict[str, Any]]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return []
    headers = [h.strip() for h in lines[0].split(",")]
    out: list[dict[str, Any]] = []
    for line in lines[1:501]:
        parts = line.split(",")
        if len(parts) < len(headers):
            parts.extend([""] * (len(headers) - len(parts)))
        out.append({headers[i]: parts[i].strip() for i in range(len(headers))})
    return out


async def fetch_source_rows(
    client: httpx.AsyncClient,
    src: dict[str, Any],
    cfg: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    """Return (rows, raw_snippet_for_llm)."""
    url = str(cfg.get("url") or "").strip()
    if not url:
        return [], ""

    kind = str(src.get("kind") or "http_json").lower()
    fetch_mode = str(src.get("fetch_mode") or cfg.get("fetch_mode") or "http").lower()
    method = str(cfg.get("method") or "GET")

    if kind == "http_csv":
        text = await fetch_text(client, url, method=method)
        return parse_csv(text), text[:30000]

    if kind == "http_index":
        if fetch_mode == "playwright":
            html = await fetch_html_playwright(
                url,
                wait_ms=int(cfg.get("wait_ms") or 1500),
            )
        else:
            html = await fetch_text(client, url, method=method)
        return [], html[:30000]

    if kind in ("http_html_table", "static_url"):
        table_selector = str(cfg.get("table_selector") or cfg.get("selector") or "").strip()
        table_index = int(cfg.get("table_index") or 0)
        if fetch_mode == "playwright":
            html = await fetch_html_playwright(
                url,
                wait_ms=int(cfg.get("wait_ms") or 1500),
            )
        else:
            html = await fetch_text(client, url, method=method)
        rows = parse_html_tables(html, table_selector=table_selector, table_index=table_index)
        return rows, html[:30000]

    data = await fetch_json(client, url, method=method)
    raw = json.dumps(data, ensure_ascii=False)[:30000]
    json_path = str(cfg.get("json_path") or cfg.get("jq_path") or "").strip()
    rows = rows_from_json_path(data, json_path)
    return rows, raw
