"""Single-shot OpenAI-compat chat call for post-stream workers (UIQE endpoint)."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx

from oaao_orchestrator.asr_common import ensure_url_scheme, openai_compat_chat_url

logger = logging.getLogger(__name__)


def _resolve_secret(env_name: str | None) -> str | None:
    if not env_name:
        return None
    v = os.environ.get(env_name)
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def _extract_json_object(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
    if fence:
        try:
            parsed = json.loads(fence.group(1).strip())
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(raw[start : end + 1])
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def uiqe_endpoint_ready(endpoint_snapshot: dict[str, Any]) -> bool:
    if not isinstance(endpoint_snapshot, dict):
        return False
    model = str(endpoint_snapshot.get("model") or "").strip()
    bu = str(endpoint_snapshot.get("base_url") or "").strip()
    url_direct = str(endpoint_snapshot.get("url") or "").strip()
    return bool(model and (bu or url_direct))


async def call_uiqe_chat(
    client: httpx.AsyncClient,
    *,
    endpoint_snapshot: dict[str, Any],
    prompt_rendered: str,
    temperature: float = 0.1,
) -> tuple[dict[str, Any] | None, str | None]:
    """Returns (parsed_json, error)."""
    if not uiqe_endpoint_ready(endpoint_snapshot):
        return None, "uiqe_endpoint_missing"

    bu = str(endpoint_snapshot.get("base_url") or "").strip()
    url_direct = str(endpoint_snapshot.get("url") or "").strip()
    model = str(endpoint_snapshot.get("model") or "").strip()
    api_key = _resolve_secret(
        endpoint_snapshot.get("api_key_env")
        if isinstance(endpoint_snapshot.get("api_key_env"), str)
        else None
    )
    url = ensure_url_scheme(url_direct) if url_direct else openai_compat_chat_url(bu)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt_rendered}],
        "temperature": temperature,
        "stream": False,
    }
    try:
        r = await client.post(
            url, headers=headers, json=body, timeout=httpx.Timeout(90.0, connect=15.0)
        )
        if r.status_code >= 400:
            return None, f"uiqe_http_{r.status_code}:{r.text[:200]}"
        data = r.json()
        choices = data.get("choices") if isinstance(data, dict) else None
        content = ""
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(msg, dict):
                content = str(msg.get("content") or "")
        parsed = _extract_json_object(content)
        if parsed is None:
            return None, "uiqe_invalid_json"
        return parsed, None
    except Exception as e:  # noqa: BLE001
        logger.warning("call_uiqe_chat failed: %s", e)
        return None, str(e)[:300]
