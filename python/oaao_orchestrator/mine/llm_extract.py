"""LLM structured extraction for mine payloads."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from oaao_orchestrator.asr_common import _resolve_secret, openai_compat_chat_url

logger = logging.getLogger(__name__)


async def extract_schema_and_rows(
    client: httpx.AsyncClient,
    *,
    raw_snippet: str,
    hints: dict[str, Any] | None,
    llm_cfg: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not llm_cfg or not isinstance(llm_cfg, dict):
        raise ValueError("llm_not_configured")

    bu = str(llm_cfg.get("base_url") or "").strip()
    model = str(llm_cfg.get("model") or "").strip()
    if not bu or not model:
        raise ValueError("llm_not_configured")

    api_key = _resolve_secret(
        llm_cfg.get("api_key_env") if isinstance(llm_cfg.get("api_key_env"), str) else None
    )
    url = openai_compat_chat_url(bu)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    domain = ""
    if hints and isinstance(hints.get("domain"), str):
        domain = hints["domain"].strip()
    examples = (
        hints.get("example_rows") if hints and isinstance(hints.get("example_rows"), list) else []
    )

    system = (
        "You extract structured tabular data from raw API/CSV/HTML snippets. "
        "Reply with JSON only (no markdown fences) using this shape:\n"
        '{"table_name":"snake_case","columns":[{"name":"col","sql_type":"TEXT|REAL|INTEGER"}],'
        '"natural_key":["col1","col2"],"rows":[{"col":"value"}]}\n'
        "Use only columns present in the data. Mark invalid rows by omitting them."
    )
    if domain:
        system += f" Domain context: {domain}."
    if examples:
        system += f" Example rows: {json.dumps(examples[:3], ensure_ascii=False)[:800]}"

    clipped = raw_snippet[:28000]
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Raw payload:\n\n{clipped}"},
        ],
        "temperature": 0.1,
        "stream": False,
    }

    r = await client.post(
        url, headers=headers, json=body, timeout=httpx.Timeout(120.0, connect=15.0)
    )
    if r.status_code >= 400:
        raise RuntimeError(f"llm_http_{r.status_code}")

    data = r.json()
    content = ""
    if isinstance(data, dict):
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                content = msg["content"].strip()

    parsed = _parse_json_object(content)
    if not isinstance(parsed, dict):
        raise ValueError("llm_invalid_json")
    rows = parsed.get("rows") if isinstance(parsed.get("rows"), list) else []
    parsed["rows"] = [r for r in rows if isinstance(r, dict)]

    usage: dict[str, Any] = {}
    if isinstance(data, dict) and isinstance(data.get("usage"), dict):
        u = data["usage"]
        usage = {
            "prompt_tokens": u.get("prompt_tokens"),
            "completion_tokens": u.get("completion_tokens"),
            "total_tokens": u.get("total_tokens"),
        }
    return parsed, usage


async def extract_rows_for_schema(
    client: httpx.AsyncClient,
    *,
    raw_snippet: str,
    schema: dict[str, Any],
    hints: dict[str, Any] | None,
    llm_cfg: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Extract rows using a fixed schema (index/list HTML sources)."""
    if not llm_cfg or not isinstance(llm_cfg, dict):
        raise ValueError("llm_not_configured")

    columns = schema.get("columns") if isinstance(schema.get("columns"), list) else []
    col_names = [str(c.get("name")) for c in columns if isinstance(c, dict) and c.get("name")]
    if not col_names:
        raise ValueError("schema_missing_columns")

    bu = str(llm_cfg.get("base_url") or "").strip()
    model = str(llm_cfg.get("model") or "").strip()
    if not bu or not model:
        raise ValueError("llm_not_configured")

    api_key = _resolve_secret(
        llm_cfg.get("api_key_env") if isinstance(llm_cfg.get("api_key_env"), str) else None
    )
    url = openai_compat_chat_url(bu)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    domain = ""
    if hints and isinstance(hints.get("domain"), str):
        domain = hints["domain"].strip()
    table_name = str(schema.get("table_name") or "data")
    natural_key = schema.get("natural_key") if isinstance(schema.get("natural_key"), list) else []

    system = (
        "You extract structured tabular rows from list/index page HTML or JSON snippets. "
        'Reply with JSON only (no markdown fences): {"rows":[{"col":"value",...},...]}\n'
        f"Table: {table_name}. Columns (use exactly these keys): {json.dumps(col_names, ensure_ascii=False)}.\n"
        "One row per logical item (e.g. one paper per arXiv entry). Omit invalid or duplicate rows."
    )
    if natural_key:
        system += f" Natural key columns: {json.dumps(natural_key, ensure_ascii=False)}."
    if domain:
        system += f" Domain: {domain}."

    clipped = raw_snippet[:28000]
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"List/index page payload:\n\n{clipped}"},
        ],
        "temperature": 0.1,
        "stream": False,
    }

    r = await client.post(
        url, headers=headers, json=body, timeout=httpx.Timeout(120.0, connect=15.0)
    )
    if r.status_code >= 400:
        raise RuntimeError(f"llm_http_{r.status_code}")

    data = r.json()
    content = ""
    if isinstance(data, dict):
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                content = msg["content"].strip()

    parsed = _parse_json_object(content)
    raw_rows = (
        parsed.get("rows")
        if isinstance(parsed, dict) and isinstance(parsed.get("rows"), list)
        else []
    )
    rows: list[dict[str, Any]] = []
    for row in raw_rows:
        if not isinstance(row, dict):
            continue
        projected = {n: row.get(n) for n in col_names if n in row}
        if projected and not all(v is None or str(v).strip() == "" for v in projected.values()):
            rows.append(projected)

    usage: dict[str, Any] = {}
    if isinstance(data, dict) and isinstance(data.get("usage"), dict):
        u = data["usage"]
        usage = {
            "prompt_tokens": u.get("prompt_tokens"),
            "completion_tokens": u.get("completion_tokens"),
            "total_tokens": u.get("total_tokens"),
        }
    return rows, usage


def _parse_json_object(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)
