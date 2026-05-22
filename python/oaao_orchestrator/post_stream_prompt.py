"""Load and render post-stream worker prompts from ``materials/prompts/workers/*.md``."""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_VAR_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")

_DEFAULT_WORKERS_DIR = Path("materials/prompts/workers")

_PLUGIN_PROMPT_REFS: dict[str, str] = {
    "iqs": "materials/prompts/workers/iqs.md",
    "accs": "materials/prompts/workers/accs.md",
}


def workers_root() -> Path:
    raw = os.environ.get("OAAO_MATERIALS_ROOT", "").strip()
    if raw:
        return Path(raw)
    return Path("/app")


def resolve_prompt_path(ref: str) -> Path | None:
    r = (ref or "").strip()
    if not r:
        return None
    p = Path(r)
    if p.is_file():
        return p
    rooted = workers_root() / r
    if rooted.is_file():
        return rooted
    alt = workers_root() / _DEFAULT_WORKERS_DIR.name / Path(r).name
    if alt.is_file():
        return alt
    logger.warning("post_stream prompt not found ref=%s", r)
    return None


def prompt_ref_for_plugin(plugin_id: str, *, bundle_ref: str = "") -> str:
    pid = (plugin_id or "").strip()
    if pid in _PLUGIN_PROMPT_REFS:
        return _PLUGIN_PROMPT_REFS[pid]
    return (bundle_ref or "").strip() or _PLUGIN_PROMPT_REFS["iqs"]


def render_worker_prompt(path: Path, variables: dict[str, Any]) -> str:
    text = path.read_text(encoding="utf-8")
    vars_map = {k: "" if v is None else str(v) for k, v in variables.items()}

    def _sub(match: re.Match[str]) -> str:
        key = match.group(1)
        return vars_map.get(key, match.group(0))

    return _VAR_PATTERN.sub(_sub, text).strip()


def build_prompt_variables(meta: dict[str, Any]) -> dict[str, Any]:
    """Template variables for worker MD — no full transcripts."""
    return {
        "conversation_id": meta.get("conversation_id", ""),
        "assistant_message_id": meta.get("assistant_message_id", ""),
        "user_id": meta.get("user_id", ""),
        "tenant_id": meta.get("tenant_id", ""),
        "workspace_id": meta.get("workspace_id", ""),
        "purpose_id": meta.get("purpose_id", ""),
        "mode_id": meta.get("mode_id", ""),
        "materials_count": meta.get("materials_count", 0),
        "task_count": meta.get("task_count", 0),
    }
