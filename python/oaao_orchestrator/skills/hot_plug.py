"""Hot-plug skill registry — manifest load, OpenAI tool merge, invocation."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from oaao_orchestrator.skills.manifest_loader import load_skills_manifest
from oaao_orchestrator.tools.registry import skill_to_openai_tool

logger = logging.getLogger(__name__)

_REQUEST_SKILLS: list[dict[str, Any]] = []
_SKILL_INDEX: dict[str, dict[str, Any]] = {}


def _sanitize_tool_name(raw: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9_]", "_", (raw or "skill").strip())[:64]
    return name or "skill"


def _row_enabled(row: dict[str, Any]) -> bool:
    return row.get("enabled", True) is not False


def _purpose_allowed(row: dict[str, Any], purpose_id: str) -> bool:
    pid = (purpose_id or "").strip().lower()
    if not pid:
        return True
    purposes = row.get("allowed_purposes")
    if not isinstance(purposes, list) or not purposes:
        return True
    allowed = {str(p).strip().lower() for p in purposes if str(p).strip()}
    return not allowed or pid in allowed


def register_request_hot_plug_skills(rows: list[Any] | None) -> None:
    """Merge per-request skills from PHP send payload (overrides file manifest by id)."""
    global _REQUEST_SKILLS, _SKILL_INDEX
    merged: dict[str, dict[str, Any]] = {}
    for row in load_skills_manifest():
        if isinstance(row, dict):
            sid = _sanitize_tool_name(str(row.get("id") or row.get("skill_id") or ""))
            if sid:
                merged[sid] = dict(row)
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        sid = _sanitize_tool_name(str(row.get("id") or row.get("skill_id") or ""))
        if sid:
            merged[sid] = dict(row)
    _REQUEST_SKILLS = list(merged.values())
    _SKILL_INDEX = {
        _sanitize_tool_name(str(r.get("id") or r.get("skill_id") or "")): r
        for r in _REQUEST_SKILLS
        if _row_enabled(r)
    }


def hot_plug_skills_for_purpose(purpose_id: str = "chat") -> list[dict[str, Any]]:
    if not _SKILL_INDEX:
        register_request_hot_plug_skills(None)
    return [
        row
        for row in _REQUEST_SKILLS
        if _row_enabled(row) and _purpose_allowed(row, purpose_id)
    ]


def openai_tools_from_hot_plug_skills(*, purpose_id: str = "chat") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in hot_plug_skills_for_purpose(purpose_id):
        tool = skill_to_openai_tool(row)
        fn = tool.get("function") if isinstance(tool.get("function"), dict) else {}
        name = _sanitize_tool_name(str(fn.get("name") or ""))
        if not name:
            continue
        fn["name"] = name
        out.append({"type": "function", "function": fn})
    return out


def _interpolate_instruction(template: str, args: dict[str, Any]) -> str:
    text = template
    for key, val in args.items():
        text = text.replace("{{" + key + "}}", str(val))
    return text


async def invoke_hot_plug_skill(name: str, arguments: str | dict[str, Any] | None) -> str | None:
    """Return tool result JSON string, or None if name is not a hot-plug skill."""
    if not _SKILL_INDEX:
        register_request_hot_plug_skills(None)
    op_name = _sanitize_tool_name(name)
    row = _SKILL_INDEX.get(op_name)
    if row is None:
        return None

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

    handler = str(row.get("handler") or "instruction").strip().lower()
    if handler == "http":
        url = str(row.get("handler_url") or "").strip()
        if not url:
            return json.dumps({"error": "missing_handler_url", "skill": op_name}, ensure_ascii=False)
        timeout = httpx.Timeout(30.0, connect=8.0)
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                resp = await client.post(
                    url,
                    json=args,
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                )
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
            logger.warning("hot_plug_skill_http_failed skill=%s err=%s", op_name, exc)
            return json.dumps({"error": str(exc)[:200]}, ensure_ascii=False)

    instruction = str(row.get("instruction") or row.get("description") or "").strip()
    if not instruction:
        instruction = f"Apply skill {op_name} with parameters: {json.dumps(args, ensure_ascii=False)}"
    rendered = _interpolate_instruction(instruction, args)
    return json.dumps(
        {"skill_id": op_name, "instruction": rendered, "parameters": args},
        ensure_ascii=False,
    )[:8000]
