"""Data Mining worker — multi-source merge → schema → SQLite upsert."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from typing import Any

import httpx

from oaao_orchestrator.mine.arxiv_index import parse_arxiv_list_html, project_rows_to_schema
from oaao_orchestrator.mine.llm_extract import extract_rows_for_schema, extract_schema_and_rows
from oaao_orchestrator.mine.source_fetch import fetch_source_rows
from oaao_orchestrator.mine.sqlite_store import (
    ensure_table,
    infer_schema_from_rows,
    merge_rows_for_schema,
    schemas_compatible,
    sqlite_abs_path,
    upsert_rows,
)

logger = logging.getLogger(__name__)


def _parse_json_field(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            dec = json.loads(raw)
            return dec if isinstance(dec, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def _parse_source_config(src: dict[str, Any]) -> dict[str, Any]:
    cfg = _parse_json_field(src.get("config_json")) or {}
    return cfg if isinstance(cfg, dict) else {}


def _is_index_source(src: dict[str, Any], cfg: dict[str, Any]) -> bool:
    kind = str(src.get("kind") or "").lower()
    if kind == "http_index":
        return True
    return str(cfg.get("source_mode") or "").lower() == "index"


def _merge_llm_usage(a: dict[str, Any] | None, b: dict[str, Any] | None) -> dict[str, Any] | None:
    if not b:
        return a
    if not a:
        return b
    out = dict(a)
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        if b.get(key) is not None:
            out[key] = int(out.get(key) or 0) + int(b[key])
    return out


def _try_arxiv_index_rows(url: str, raw_snippet: str, schema: dict[str, Any] | None) -> list[dict[str, Any]]:
    if "arxiv.org/list" not in url.lower() and "arxiv.org/list" not in raw_snippet.lower():
        return []
    rows = parse_arxiv_list_html(raw_snippet)
    if schema:
        rows = project_rows_to_schema(rows, schema)
    return rows


async def _resolve_index_batch_rows(
    client: httpx.AsyncClient,
    *,
    batch: dict[str, Any],
    schema: dict[str, Any],
    llm_cfg: dict[str, Any] | None,
    llm_hints: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    rows = batch.get("rows") if isinstance(batch.get("rows"), list) else []
    if rows:
        return rows, None

    raw_snippet = str(batch.get("raw_snippet") or "")
    url = str(batch.get("url") or "")
    heuristic = _try_arxiv_index_rows(url, raw_snippet, schema)
    if heuristic:
        return heuristic, None

    if not llm_cfg:
        raise ValueError("index_requires_schema")

    ext_rows, usage = await extract_rows_for_schema(
        client,
        raw_snippet=raw_snippet,
        schema=schema,
        hints=llm_hints,
        llm_cfg=llm_cfg,
    )
    return ext_rows, usage


async def _report_mine_usage(payload: dict[str, Any], usage: dict[str, Any] | None) -> None:
    if not usage:
        return
    from oaao_orchestrator.mine.usage import report_mine_llm_usage  # noqa: PLC0415

    tenant_id = int(payload.get("tenant_id") or 0)
    user_id = int(payload.get("user_id") or 0)
    mine = payload.get("mine") if isinstance(payload.get("mine"), dict) else {}
    mine_id = int(mine.get("mine_id") or 0) if isinstance(mine.get("mine_id"), int) else None
    await report_mine_llm_usage(
        tenant_id=tenant_id,
        user_id=user_id,
        mine_id=mine_id,
        usage=usage,
    )


async def run_mine_job(payload: dict[str, Any]) -> dict[str, Any]:
    mine = payload.get("mine") if isinstance(payload.get("mine"), dict) else {}
    sources = payload.get("sources") if isinstance(payload.get("sources"), list) else []
    run_id = int(payload.get("run_id") or 0)
    sqlite_root = str(payload.get("sqlite_root") or os.environ.get("OAAO_MINE_DATA_ROOT") or "/tmp/oaao-mine").strip()
    sqlite_rel = str(payload.get("sqlite_path") or "").strip()
    llm_cfg = payload.get("mine_llm") if isinstance(payload.get("mine_llm"), dict) else None
    llm_hints = _parse_json_field(mine.get("llm_hints_json"))
    stored_schema = _parse_json_field(mine.get("schema_json"))

    stats: dict[str, Any] = {
        "rows_parsed": 0,
        "rows_inserted": 0,
        "rows_updated": 0,
        "schema_changed": False,
        "sources_ok": 0,
        "errors": [],
    }
    llm_usage: dict[str, Any] | None = None

    if run_id < 1 or not sqlite_rel or not sources:
        return {"ok": False, "error": "invalid_job_payload", "stats": stats}

    db_path = sqlite_abs_path(sqlite_root, sqlite_rel)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    try:
        batches: list[dict[str, Any]] = []
        combined_snippet_parts: list[str] = []
        has_index_source = False

        async with httpx.AsyncClient() as client:
            for src in sources:
                if not isinstance(src, dict):
                    continue
                cfg = _parse_source_config(src)
                url = str(cfg.get("url") or "").strip()
                if not url:
                    continue
                is_index = _is_index_source(src, cfg)
                if is_index:
                    has_index_source = True
                source_key = str(src.get("source_id") or url)[:120]
                try:
                    rows, raw_snippet = await fetch_source_rows(client, src, cfg)
                    column_map = cfg.get("column_map") if isinstance(cfg.get("column_map"), dict) else None
                    if column_map:
                        remapped: list[dict[str, Any]] = []
                        for row in rows:
                            if not isinstance(row, dict):
                                continue
                            out: dict[str, Any] = {}
                            for src_col, dst_col in column_map.items():
                                if src_col in row:
                                    out[str(dst_col)] = row[src_col]
                            if out:
                                remapped.append(out)
                        rows = remapped
                    stats["rows_parsed"] += len(rows)
                    batches.append(
                        {
                            "source_key": source_key,
                            "rows": rows,
                            "raw_snippet": raw_snippet,
                            "url": url,
                            "is_index": is_index,
                        }
                    )
                    if raw_snippet:
                        combined_snippet_parts.append(raw_snippet[:8000])
                    stats["sources_ok"] += 1
                except Exception as exc:  # noqa: BLE001
                    logger.warning("mine source failed %s: %s", url, exc)
                    stats["errors"].append({"url": url, "error": str(exc)[:200]})

            if not batches:
                return {"ok": False, "error": "no_rows_fetched", "stats": stats}

            merged_preview = merge_rows_for_schema([b["rows"] for b in batches])
            schema = stored_schema
            use_llm = schema is None and llm_cfg is not None
            index_batches_pending = [b for b in batches if b.get("is_index") and not b["rows"]]

            if index_batches_pending and schema is None:
                for batch in index_batches_pending:
                    heuristic = _try_arxiv_index_rows(
                        str(batch.get("url") or ""),
                        str(batch.get("raw_snippet") or ""),
                        None,
                    )
                    if heuristic:
                        batch["rows"] = heuristic
                        stats["rows_parsed"] += len(heuristic)
                index_batches_pending = [b for b in batches if b.get("is_index") and not b["rows"]]
                if index_batches_pending and not use_llm:
                    return {"ok": False, "error": "index_requires_schema", "stats": stats}
                merged_preview = merge_rows_for_schema([b["rows"] for b in batches])

            if schema is None and not use_llm:
                schema = infer_schema_from_rows(merged_preview, table_name="data")
            elif use_llm:
                combined = "\n---\n".join(combined_snippet_parts)[:28000]
                extracted, llm_usage = await extract_schema_and_rows(
                    client,
                    raw_snippet=combined,
                    hints=llm_hints,
                    llm_cfg=llm_cfg,
                )
                schema = {
                    "table_name": extracted.get("table_name"),
                    "columns": extracted.get("columns"),
                    "natural_key": extracted.get("natural_key"),
                }
                ext_rows = extracted.get("rows") if isinstance(extracted.get("rows"), list) else []
                if ext_rows and not any(len(b["rows"]) for b in batches):
                    batches = [
                        {
                            "source_key": "llm",
                            "rows": [r for r in ext_rows if isinstance(r, dict)],
                            "raw_snippet": combined,
                            "url": "",
                            "is_index": False,
                        }
                    ]
                    index_batches_pending = []

            if schema is None:
                if has_index_source and index_batches_pending:
                    return {"ok": False, "error": "index_requires_schema", "stats": stats}
                return {"ok": False, "error": "no_schema", "stats": stats}

            for batch in batches:
                if not batch.get("is_index") or batch["rows"]:
                    continue
                try:
                    rows, usage = await _resolve_index_batch_rows(
                        client,
                        batch=batch,
                        schema=schema,
                        llm_cfg=llm_cfg,
                        llm_hints=llm_hints,
                    )
                    batch["rows"] = rows
                    stats["rows_parsed"] += len(rows)
                    llm_usage = _merge_llm_usage(llm_usage, usage)
                except ValueError as exc:
                    if str(exc) == "index_requires_schema":
                        return {"ok": False, "error": "index_requires_schema", "stats": stats}
                    raise
                except Exception as exc:  # noqa: BLE001
                    logger.warning("mine index extract failed %s: %s", batch.get("url"), exc)
                    stats["errors"].append(
                        {"url": str(batch.get("url") or ""), "error": str(exc)[:200]}
                    )

            if stored_schema and not schemas_compatible(stored_schema, schema):
                return {
                    "ok": False,
                    "error": "schema_mismatch",
                    "stats": stats,
                    "schema_json": stored_schema,
                }

            table, col_names, natural_key = ensure_table(conn, schema)
            if stored_schema is None:
                stored_schema = schema
                stats["schema_changed"] = True

            for batch in batches:
                rows = batch["rows"]
                if not rows:
                    continue
                ins, upd = upsert_rows(
                    conn,
                    table=table,
                    col_names=col_names,
                    natural_key=natural_key,
                    rows=rows,
                    run_id=run_id,
                    source_key=str(batch["source_key"]),
                )
                stats["rows_inserted"] += ins
                stats["rows_updated"] += upd

        await _report_mine_usage(payload, llm_usage)

        return {
            "ok": True,
            "stats": stats,
            "schema_json": stored_schema,
            "new_rows": stats["rows_inserted"],
            "usage": llm_usage,
        }
    finally:
        conn.close()
