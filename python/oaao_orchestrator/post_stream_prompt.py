"""Load and render post-stream worker prompts from ``materials/prompts/workers/*.md``."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from oaao_orchestrator.prompt_template import (
    load_template_body,
    prompts_subdir,
    render_template_text,
    resolve_template_path,
)

logger = logging.getLogger(__name__)

_DEFAULT_WORKERS_DIR = Path("materials/prompts/workers")

_PLUGIN_PROMPT_REFS: dict[str, str] = {
    "iqs": "materials/prompts/workers/iqs.md",
    "accs": "materials/prompts/workers/accs.md",
}


def workers_root() -> Path:
    from oaao_orchestrator.prompt_template import materials_root

    return materials_root()


def resolve_prompt_path(ref: str) -> Path | None:
    return resolve_template_path(ref, search_dirs=(prompts_subdir("workers"),))


def prompt_ref_for_plugin(plugin_id: str, *, bundle_ref: str = "") -> str:
    pid = (plugin_id or "").strip()
    if pid in _PLUGIN_PROMPT_REFS:
        return _PLUGIN_PROMPT_REFS[pid]
    return (bundle_ref or "").strip() or _PLUGIN_PROMPT_REFS["iqs"]


def render_worker_prompt(path: Path, variables: dict[str, Any]) -> str:
    text = path.read_text(encoding="utf-8")
    return render_template_text(text, variables)


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


def load_worker_prompt_body(ref: str) -> str:
    return load_template_body(ref=ref, search_dirs=(prompts_subdir("workers"),))
