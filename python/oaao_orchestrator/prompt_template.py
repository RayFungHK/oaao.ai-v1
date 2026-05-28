"""Shared markdown prompt loading and ``{{variable}}`` rendering for purpose-bound templates."""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_VAR_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

PROMPT_KIND_CONVERSATION = "conversation"
PROMPT_KIND_COMMAND = "command_template"


def materials_root() -> Path:
    raw = os.environ.get("OAAO_MATERIALS_ROOT", "").strip()
    if raw:
        return Path(raw)
    return Path("/app")


def polish_templates_dir() -> Path:
    env = os.environ.get("OAAO_POLISH_TEMPLATES_DIR", "").strip()
    if env:
        return Path(env)
    return materials_root() / "python" / "materials" / "prompts" / "templates"


def prompts_subdir(name: str) -> Path:
    return materials_root() / "python" / "materials" / "prompts" / name


def resolve_template_path(
    ref: str = "",
    *,
    extra_refs: tuple[str, ...] = (),
    search_dirs: tuple[Path, ...] | None = None,
) -> Path | None:
    """Resolve a template file from ref, env fallbacks, materials root, and search dirs."""
    dirs = search_dirs or (
        polish_templates_dir(),
        prompts_subdir("templates"),
        prompts_subdir("workers"),
        prompts_subdir("planning"),
        prompts_subdir("evolution"),
    )
    candidates: list[Path] = []
    for raw in (ref.strip(), *extra_refs):
        if not raw:
            continue
        p = Path(raw)
        if p.is_file():
            candidates.append(p)
            continue
        rooted = materials_root() / raw
        if rooted.is_file():
            candidates.append(rooted)
            continue
        for base in dirs:
            named = base / Path(raw).name
            if named.is_file():
                candidates.append(named)
    seen: set[Path] = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        if path.is_file():
            return path
    return None


def render_template_text(text: str, variables: dict[str, Any]) -> str:
    vars_map = {k: "" if v is None else str(v) for k, v in variables.items()}

    def _sub(match: re.Match[str]) -> str:
        key = match.group(1)
        return vars_map.get(key, match.group(0))

    return _VAR_PATTERN.sub(_sub, text).strip()


def load_template_body(
    path: Path | None = None,
    *,
    ref: str = "",
    fallback: str = "",
    extra_refs: tuple[str, ...] = (),
    search_dirs: tuple[Path, ...] | None = None,
) -> str:
    resolved = path or resolve_template_path(ref, extra_refs=extra_refs, search_dirs=search_dirs)
    if resolved is None:
        if fallback:
            logger.warning("prompt template not found ref=%s — using fallback", ref or extra_refs)
            return fallback
        logger.warning("prompt template not found ref=%s", ref or extra_refs)
        return ""
    text = resolved.read_text(encoding="utf-8")
    text = _HTML_COMMENT_RE.sub("", text)
    return text.strip()


def prompt_config_from_purpose_payload(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    """Read ``prompt`` block from orchestrator purpose payload (``planner``, ``planner_intent``, …)."""
    if not isinstance(payload, dict):
        return None
    prompt = payload.get("prompt")
    if not isinstance(prompt, dict):
        return None
    kind = str(prompt.get("kind") or "").strip().lower()
    if kind not in (PROMPT_KIND_CONVERSATION, PROMPT_KIND_COMMAND):
        return None
    return prompt


def command_template_ref(
    prompt_cfg: dict[str, Any] | None,
    *,
    env_key: str = "",
    default_ref: str = "",
) -> str:
    if isinstance(prompt_cfg, dict):
        ref = str(prompt_cfg.get("template_ref") or "").strip()
        if ref:
            return ref
    if env_key:
        env = os.environ.get(env_key, "").strip()
        if env:
            return env
    return default_ref
