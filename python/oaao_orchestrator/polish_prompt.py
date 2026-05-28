"""Load and render ASR polish template prompts from ``materials/prompts/templates/*.md``.

Template prompts (no chat history): edit the ``.md`` file to tune polish behaviour —
no Python deploy required when mounted via ``OAAO_POLISH_TEMPLATES_DIR``.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_VAR_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

DEFAULT_TEMPLATE_ID = "asr_polish"
DEFAULT_TEMPLATE_REF = "materials/prompts/templates/asr_polish.md"

_FALLBACK_TEMPLATE = (
    "You are an ASR polish expert. Polish the following transcript into {{style}} style. "
    "The user's language is {{locale}}. Return only the polished text — no labels, headings, or explanations.\n\n"
    "{{raw}}"
)


def materials_root() -> Path:
    raw = os.environ.get("OAAO_MATERIALS_ROOT", "").strip()
    if raw:
        return Path(raw)
    return Path("/app")


def templates_dir() -> Path:
    env = os.environ.get("OAAO_POLISH_TEMPLATES_DIR", "").strip()
    if env:
        return Path(env)
    return materials_root() / "python" / "materials" / "prompts" / "templates"


def resolve_template_path(ref: str = "") -> Path | None:
    """Resolve template by env ref, explicit ref, or default ``asr_polish.md``."""
    candidates: list[Path] = []
    for raw in (
        ref.strip(),
        os.environ.get("OAAO_POLISH_TEMPLATE_REF", "").strip(),
        DEFAULT_TEMPLATE_REF,
        f"{DEFAULT_TEMPLATE_ID}.md",
    ):
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
        named = templates_dir() / Path(raw).name
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


def load_template_body(path: Path | None = None, *, ref: str = "") -> str:
    resolved = path or resolve_template_path(ref)
    if resolved is None:
        logger.warning("polish template not found ref=%s — using built-in fallback", ref or DEFAULT_TEMPLATE_REF)
        return _FALLBACK_TEMPLATE
    text = resolved.read_text(encoding="utf-8")
    text = _HTML_COMMENT_RE.sub("", text)
    return text.strip()


def render_polish_user_message(
    *,
    locale: str,
    style: str,
    raw: str,
    template_ref: str = "",
) -> str:
    """Render the full user message for ASR polish (template prompt + variables)."""
    body = load_template_body(ref=template_ref)
    quoted = (raw or "").strip().replace('"', '\\"')
    return render_template_text(
        body,
        {
            "locale": locale,
            "style": style,
            "raw": quoted,
        },
    )
