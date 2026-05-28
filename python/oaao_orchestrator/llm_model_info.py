"""OpenAI-compatible /v1/models probe for context limits."""

from __future__ import annotations

from typing import Any

import httpx

from oaao_orchestrator.vault_graph_rag import ensure_url_scheme

_model_limits_cache: dict[str, dict[str, Any]] = {}


def openai_compat_models_url(base_url: str) -> str:
    bu = ensure_url_scheme(base_url.rstrip("/"))
    if bu.endswith("/models"):
        return bu
    if bu.endswith("/v1"):
        return f"{bu}/models"
    return f"{bu}/v1/models"


def _match_model_entry(entries: list[Any], model: str) -> dict[str, Any] | None:
    target = (model or "").strip()
    if not target or not entries:
        return None
    exact: dict[str, Any] | None = None
    suffix: dict[str, Any] | None = None
    for item in entries:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("id") or item.get("model") or "").strip()
        if not mid:
            continue
        if mid == target:
            exact = item
            break
        if mid.endswith("/" + target) or target.endswith("/" + mid):
            suffix = item
    return exact or suffix


def suggested_max_output_tokens(max_model_len: int) -> int:
    """Leave headroom for polish prompts on small-context hosts."""
    cap = int(max_model_len * 0.35)
    return max(64, min(512, cap))


async def fetch_openai_compat_model_limits(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    model: str,
    api_key: str | None = None,
    timeout_sec: float = 5.0,
) -> dict[str, Any]:
    cache_key = f"{base_url.rstrip('/')}|{model}|{bool(api_key)}"
    cached = _model_limits_cache.get(cache_key)
    if cached is not None:
        return dict(cached)

    url = openai_compat_models_url(base_url)
    headers: dict[str, str] = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    result: dict[str, Any] = {
        "max_model_len": None,
        "model_id": model,
        "suggested_max_output_tokens": None,
    }
    try:
        r = await client.get(
            url,
            headers=headers,
            timeout=httpx.Timeout(timeout_sec, connect=min(3.0, timeout_sec)),
        )
        if r.status_code >= 400:
            result["error"] = f"http_{r.status_code}"
            _model_limits_cache[cache_key] = result
            return dict(result)
        data = r.json()
        entries = data.get("data") if isinstance(data, dict) else None
        if not isinstance(entries, list):
            _model_limits_cache[cache_key] = result
            return dict(result)
        picked = _match_model_entry(entries, model)
        if picked is None:
            result["error"] = "model_not_found"
            _model_limits_cache[cache_key] = result
            return dict(result)
        raw_len = picked.get("max_model_len")
        if raw_len is None:
            raw_len = picked.get("context_length")
        if raw_len is not None:
            try:
                ml = max(256, min(int(raw_len), 131072))
                result["max_model_len"] = ml
                result["model_id"] = str(picked.get("id") or model)
                result["suggested_max_output_tokens"] = suggested_max_output_tokens(ml)
            except (TypeError, ValueError):
                pass
    except httpx.TimeoutException:
        result["error"] = "timeout"
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)[:120]

    _model_limits_cache[cache_key] = result
    return dict(result)
