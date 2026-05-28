"""Load and render ASR polish template prompts from ``materials/prompts/templates/*.md``.

Template prompts (no chat history): edit the ``.md`` file to tune polish behaviour —
no Python deploy required when mounted via ``OAAO_POLISH_TEMPLATES_DIR``.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from oaao_orchestrator.prompt_template import (
    load_template_body as _load_template_body,
    polish_templates_dir,
    render_template_text,
    resolve_template_path as _resolve_template_path,
)

logger = logging.getLogger(__name__)

DEFAULT_TEMPLATE_ID = "asr_polish"
DEFAULT_TEMPLATE_REF = "materials/prompts/templates/asr_polish.md"

_FALLBACK_TEMPLATE = (
    "You are an ASR polish expert. Polish the following transcript into {{style}} style. "
    "The user's language is {{locale}}. Return only the polished text — no labels, headings, or explanations.\n\n"
    "{{raw}}"
)


def materials_root() -> Path:
    from oaao_orchestrator.prompt_template import materials_root as _root

    return _root()


def templates_dir() -> Path:
    return polish_templates_dir()


def load_template_body(path: Path | None = None, *, ref: str = "") -> str:
    return _load_template_body(
        path,
        ref=ref,
        fallback=_FALLBACK_TEMPLATE,
        extra_refs=(
            os.environ.get("OAAO_POLISH_TEMPLATE_REF", "").strip(),
            DEFAULT_TEMPLATE_REF,
            f"{DEFAULT_TEMPLATE_ID}.md",
        ),
        search_dirs=(polish_templates_dir(),),
    )


def resolve_template_path(ref: str = "") -> Path | None:
    """Resolve template by env ref, explicit ref, or default ``asr_polish.md``."""
    return _resolve_template_path(
        ref,
        extra_refs=(
            os.environ.get("OAAO_POLISH_TEMPLATE_REF", "").strip(),
            DEFAULT_TEMPLATE_REF,
            f"{DEFAULT_TEMPLATE_ID}.md",
        ),
        search_dirs=(polish_templates_dir(),),
    )


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
