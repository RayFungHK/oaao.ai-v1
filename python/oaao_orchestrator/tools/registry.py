"""Tool server registry — per-purpose whitelist + MicroSkill → OpenAI tool."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

from oaao_orchestrator.tools.openapi_adapter import openapi_to_openai_tools
from oaao_orchestrator.tools.openapi_fetch import fetch_openapi_spec_sync


@dataclass
class ToolServerSpec:
    id: str
    base_url: str
    openapi_url: str = "/openapi.json"
    allowed_purposes: list[str] = field(default_factory=lambda: ["chat", "planning"])
    openapi_spec: dict[str, Any] | None = None


_REGISTRY: dict[str, ToolServerSpec] = {}


def ensure_openapi_spec(spec: ToolServerSpec) -> dict[str, Any] | None:
    """Return cached or freshly fetched OpenAPI document for a tool server."""
    if isinstance(spec.openapi_spec, dict) and spec.openapi_spec.get("paths"):
        return spec.openapi_spec
    fetched = fetch_openapi_spec_sync(base_url=spec.base_url, openapi_url=spec.openapi_url)
    if fetched:
        spec.openapi_spec = fetched
        _REGISTRY[spec.id.strip()] = spec
    return fetched


def register_tool_server(spec: ToolServerSpec) -> None:
    ensure_openapi_spec(spec)
    _REGISTRY[spec.id.strip()] = spec


def list_tool_servers(*, purpose_id: str | None = None) -> list[ToolServerSpec]:
    pid = (purpose_id or "").strip().lower()
    rows = list(_REGISTRY.values())
    if not pid:
        return rows
    return [
        s for s in rows if not s.allowed_purposes or pid in {p.lower() for p in s.allowed_purposes}
    ]


def load_tool_servers_from_env() -> None:
    """Load JSON manifest from ``OAAO_TOOL_SERVERS_JSON`` or ``OAAO_TOOL_SERVERS_PATH``."""
    raw = (os.environ.get("OAAO_TOOL_SERVERS_JSON") or "").strip()
    path = (os.environ.get("OAAO_TOOL_SERVERS_PATH") or "").strip()
    if not raw and path and os.path.isfile(path):
        raw = open(path, encoding="utf-8").read()  # noqa: SIM115
    if not raw:
        return
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return
    servers = (
        data if isinstance(data, list) else data.get("servers") if isinstance(data, dict) else None
    )
    if not isinstance(servers, list):
        return
    for row in servers:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("id") or "").strip()
        base = str(row.get("base_url") or "").strip()
        if not sid or not base:
            continue
        purposes = row.get("allowed_purposes")
        allowed = [str(p) for p in purposes] if isinstance(purposes, list) else ["chat"]
        spec_dict = row.get("openapi_spec")
        register_tool_server(
            ToolServerSpec(
                id=sid,
                base_url=base.rstrip("/"),
                openapi_url=str(row.get("openapi_url") or "/openapi.json"),
                allowed_purposes=allowed,
                openapi_spec=spec_dict if isinstance(spec_dict, dict) else None,
            )
        )


def tools_for_purpose(purpose_id: str) -> list[dict[str, Any]]:
    load_tool_servers_from_env()
    out: list[dict[str, Any]] = []
    for spec in list_tool_servers(purpose_id=purpose_id):
        oas = ensure_openapi_spec(spec)
        if isinstance(oas, dict):
            out.extend(openapi_to_openai_tools(oas))
    return out


def merge_openai_tools(
    base: list[dict[str, Any]] | None,
    *,
    purpose_id: str = "chat",
    extra: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source in (base or [], tools_for_purpose(purpose_id), extra or []):
        for tool in source:
            if not isinstance(tool, dict):
                continue
            fn = tool.get("function") if isinstance(tool.get("function"), dict) else tool
            name = str(fn.get("name") or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
            merged.append(
                tool if tool.get("type") == "function" else {"type": "function", "function": fn}
            )
    return merged


def skill_to_openai_tool(skill: dict[str, Any]) -> dict[str, Any]:
    """Convert a MicroSkill manifest row to an OpenAI tool schema."""
    name = str(skill.get("id") or skill.get("skill_id") or "skill").strip()[:64]
    desc = str(skill.get("description") or skill.get("label") or name).strip()[:512]
    params = skill.get("parameters")
    if not isinstance(params, dict):
        params = {"type": "object", "properties": {}}
    return {
        "type": "function",
        "function": {"name": name, "description": desc, "parameters": params},
    }
