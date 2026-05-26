"""Invoke registered OpenAPI tool servers from LLM function calls."""

from __future__ import annotations

import json
import logging
from typing import Any
from urllib.parse import urljoin

import httpx

from oaao_orchestrator.tools.registry import (
    ToolServerSpec,
    list_tool_servers,
    load_tool_servers_from_env,
)

logger = logging.getLogger(__name__)

# operationId -> (server_id, method, path)
_OPERATION_INDEX: dict[str, tuple[str, str, str]] = {}


def rebuild_operation_index() -> None:
    """Map OpenAI function names (operationId) to HTTP routes."""
    from oaao_orchestrator.tools.registry import ensure_openapi_spec

    load_tool_servers_from_env()
    _OPERATION_INDEX.clear()
    for spec in list_tool_servers():
        oas = ensure_openapi_spec(spec)
        if not isinstance(oas, dict):
            continue
        paths = oas.get("paths")
        if not isinstance(paths, dict):
            continue
        for path, methods in paths.items():
            if not isinstance(methods, dict):
                continue
            for method, op in methods.items():
                if method.lower() not in ("get", "post", "put", "patch", "delete"):
                    continue
                if not isinstance(op, dict):
                    continue
                op_id = str(
                    op.get("operationId") or f"{method}_{path.strip('/').replace('/', '_')}"
                ).strip()
                if op_id:
                    _OPERATION_INDEX[op_id[:64]] = (spec.id, method.lower(), str(path))


def _server_by_id(server_id: str) -> ToolServerSpec | None:
    for spec in list_tool_servers():
        if spec.id == server_id:
            return spec
    return None


async def invoke_openapi_tool(name: str, arguments: str | dict[str, Any] | None) -> str:
    """Call tool server operation; returns JSON string for tool role message."""
    rebuild_operation_index()
    op_name = (name or "").strip()[:64]
    route = _OPERATION_INDEX.get(op_name)
    if not route:
        return json.dumps({"error": f"unknown_tool:{op_name}"}, ensure_ascii=False)
    server_id, method, path = route
    spec = _server_by_id(server_id)
    if spec is None:
        return json.dumps({"error": f"unknown_server:{server_id}"}, ensure_ascii=False)

    args: dict[str, Any] = {}
    if isinstance(arguments, str) and arguments.strip():
        try:
            parsed = json.loads(arguments)
            if isinstance(parsed, dict):
                args = parsed
        except json.JSONDecodeError:
            args = {"input": arguments}
    elif isinstance(arguments, dict):
        args = dict(arguments)

    base = spec.base_url.rstrip("/")
    url = urljoin(f"{base}/", path.lstrip("/"))
    headers = {"Accept": "application/json"}
    timeout = httpx.Timeout(30.0, connect=8.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            if method == "get":
                resp = await client.get(url, params=args, headers=headers)
            else:
                headers["Content-Type"] = "application/json"
                resp = await client.request(method.upper(), url, json=args, headers=headers)
            text = resp.text[:8000]
            if resp.status_code >= 400:
                return json.dumps(
                    {"error": f"http_{resp.status_code}", "body": text[:500]},
                    ensure_ascii=False,
                )
            try:
                data = resp.json()
                return json.dumps(data, ensure_ascii=False)[:8000]
            except json.JSONDecodeError:
                return json.dumps({"result": text}, ensure_ascii=False)[:8000]
    except Exception as exc:  # noqa: BLE001
        logger.warning("tool_invoke_failed op=%s err=%s", op_name, exc)
        return json.dumps({"error": str(exc)[:200]}, ensure_ascii=False)


async def invoke_llm_tool(name: str, arguments: str | dict[str, Any] | None) -> str:
    """OpenAPI tool server first, then hot-plug skill manifest."""
    result = await invoke_openapi_tool(name, arguments)
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
            if isinstance(parsed, dict) and str(parsed.get("error") or "").startswith("unknown_tool:"):
                from oaao_orchestrator.skills.hot_plug import invoke_hot_plug_skill

                skill_result = await invoke_hot_plug_skill(name, arguments)
                if skill_result is not None:
                    return skill_result
        except json.JSONDecodeError:
            pass
    return result
