"""Mine source discovery preview — infer dataset schema before creating a mine."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.mine.arxiv_index import parse_arxiv_list_html, project_rows_to_schema
from oaao_orchestrator.mine.llm_extract import extract_rows_for_schema
from oaao_orchestrator.mine.source_fetch import fetch_source_rows
from oaao_orchestrator.mine.sqlite_store import infer_schema_from_rows, merge_rows_for_schema
from oaao_orchestrator.page_router.classify import (
    classify_page,
    classify_page_llm,
    classify_page_rules,
    needs_confirmation,
    resolve_mine_kind,
)
from oaao_orchestrator.research.fetch import _fetch_html

logger = logging.getLogger(__name__)


async def _fetch_page_html(
    client: httpx.AsyncClient,
    url: str,
    *,
    use_playwright: bool = False,
) -> str:
    if use_playwright:
        try:
            from oaao_orchestrator.mine.playwright_fetch import (
                fetch_html_playwright,
            )

            return await fetch_html_playwright(url, wait_ms=1500)
        except Exception as exc:  # noqa: BLE001
            logger.warning("playwright fetch failed %s: %s", url, exc)
    return await _fetch_html(client, url)


async def _classify_url(
    client: httpx.AsyncClient,
    url: str,
    html: str,
    *,
    llm_cfg: dict[str, Any] | None,
    use_llm: bool,
) -> dict[str, Any]:
    ruled = classify_page_rules(url)
    if ruled:
        return ruled
    classification = classify_page(html, url)
    conf = float(classification.get("confidence") or 0)
    page_type = str(classification.get("page_type") or "unknown")
    if use_llm and llm_cfg and (page_type == "unknown" or conf < 0.72):
        features = classification.get("features")
        if not isinstance(features, dict):
            from oaao_orchestrator.page_router.features import (
                extract_page_features,
            )

            features = extract_page_features(html, url)
        try:
            llm_cls = await classify_page_llm(client, features=features, llm_cfg=llm_cfg)
            return {
                "page_type": llm_cls.get("page_type"),
                "confidence": llm_cls.get("confidence"),
                "method": "llm",
                "reason": llm_cls.get("reason"),
                "usage": llm_cls.get("usage"),
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning("mine classify llm failed %s: %s", url, exc)
    return classification


async def discover_mine_source(
    client: httpx.AsyncClient,
    *,
    url: str,
    kind: str = "auto",
    llm_cfg: dict[str, Any] | None = None,
    use_llm: bool = True,
    use_playwright: bool = False,
    schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    url = (url or "").strip()
    if not url:
        return {"ok": False, "error": "url_required"}

    html = await _fetch_page_html(client, url, use_playwright=use_playwright)
    classification = await _classify_url(client, url, html, llm_cfg=llm_cfg, use_llm=use_llm)
    page_type = str(classification.get("page_type") or "unknown")
    conf = float(classification.get("confidence") or 0)
    resolved_kind = resolve_mine_kind(page_type)
    if kind not in ("", "auto"):
        resolved_kind = kind

    src_def = {"kind": resolved_kind, "fetch_mode": "playwright" if use_playwright else "http"}
    cfg: dict[str, Any] = {"url": url}
    rows: list[dict[str, Any]] = []
    raw_snippet = html[:30000]

    if resolved_kind == "http_index":
        if "arxiv.org/list" in url.lower():
            rows = parse_arxiv_list_html(html)
        elif use_llm and llm_cfg and schema:
            try:
                rows, _usage = await extract_rows_for_schema(
                    client,
                    raw_snippet=raw_snippet,
                    schema=schema,
                    hints=None,
                    llm_cfg=llm_cfg,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("mine index llm extract preview failed: %s", exc)
        elif use_llm and llm_cfg:
            # Provisional schema for preview
            prov = {
                "table_name": "preview",
                "columns": [
                    {"name": "title", "sql_type": "TEXT"},
                    {"name": "url", "sql_type": "TEXT"},
                ],
                "natural_key": ["url"],
            }
            try:
                rows, _usage = await extract_rows_for_schema(
                    client,
                    raw_snippet=raw_snippet,
                    schema=prov,
                    hints=None,
                    llm_cfg=llm_cfg,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("mine index llm preview failed: %s", exc)
    else:
        rows, raw_snippet = await fetch_source_rows(client, src_def, cfg)

    if schema and rows:
        rows = project_rows_to_schema(rows, schema) if resolved_kind == "http_index" else rows

    from oaao_orchestrator.page_router.features import extract_page_features

    feat = extract_page_features(html, url)

    return {
        "ok": True,
        "url": url,
        "page_type": page_type,
        "confidence": conf,
        "method": classification.get("method"),
        "reason": classification.get("reason"),
        "resolved_kind": resolved_kind,
        "needs_confirmation": needs_confirmation(conf, page_type),
        "sample_rows": rows[:20],
        "row_count": len(rows),
        "html_hash": feat.get("html_hash"),
        "usage": classification.get("usage"),
    }


async def discover_mine_sources(payload: dict[str, Any]) -> dict[str, Any]:
    sources = payload.get("sources") if isinstance(payload.get("sources"), list) else []
    llm_cfg = payload.get("llm_cfg") if isinstance(payload.get("llm_cfg"), dict) else None
    use_llm = bool(payload.get("use_llm", True))
    use_playwright = bool(payload.get("use_playwright", False))
    schema = payload.get("schema_json") if isinstance(payload.get("schema_json"), dict) else None

    if not sources:
        urls = payload.get("urls") if isinstance(payload.get("urls"), list) else []
        sources = [{"url": u, "kind": "auto"} for u in urls if str(u).strip()]

    previews: list[dict[str, Any]] = []
    all_rows: list[dict[str, Any]] = []
    dominant_type = "static"
    index_count = 0

    async with httpx.AsyncClient() as client:
        for src in sources:
            if not isinstance(src, dict):
                continue
            url = str(src.get("url") or "").strip()
            if not url:
                continue
            kind = str(src.get("kind") or "auto").lower()
            try:
                prev = await discover_mine_source(
                    client,
                    url=url,
                    kind=kind,
                    llm_cfg=llm_cfg,
                    use_llm=use_llm,
                    use_playwright=use_playwright,
                    schema=schema,
                )
                previews.append(prev)
                if prev.get("resolved_kind") == "http_index":
                    index_count += 1
                for row in (
                    prev.get("sample_rows") if isinstance(prev.get("sample_rows"), list) else []
                ):
                    if isinstance(row, dict):
                        all_rows.append(row)
            except Exception as exc:  # noqa: BLE001
                previews.append({"ok": False, "url": url, "error": str(exc)[:200]})

    if index_count > 0 and index_count >= len(previews) // 2 + 1:
        dominant_type = "index"
    elif len(previews) > 1 and index_count == 0:
        dominant_type = "multi_static"

    suggested_schema = schema
    if not suggested_schema and all_rows:
        table = "dataset"
        if len(previews) == 1 and previews[0].get("ok"):
            host = (
                str(previews[0].get("url") or "data").split("/")[2]
                if previews[0].get("url")
                else "data"
            )
            table = host.replace(".", "_")[:32]
        suggested_schema = infer_schema_from_rows(
            merge_rows_for_schema([all_rows]), table_name=table
        )

    any_needs = any(p.get("needs_confirmation") for p in previews if p.get("ok"))
    if dominant_type == "index" and not suggested_schema:
        any_needs = True

    return {
        "ok": True,
        "previews": previews,
        "dataset_mode": dominant_type,
        "suggested_schema": suggested_schema,
        "sample_rows": all_rows[:25],
        "row_count": len(all_rows),
        "needs_confirmation": any_needs,
    }
