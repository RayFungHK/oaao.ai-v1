"""Inject Corpus profile style into chat LLM messages."""

from __future__ import annotations

import json
from typing import Any


def build_corpus_style_system_block(corpus_style: dict[str, Any] | None) -> str | None:
    if not corpus_style or not isinstance(corpus_style, dict):
        return None

    name = str(corpus_style.get("name") or "").strip() or "Corpus profile"
    status = str(corpus_style.get("status") or "").strip()
    if status and status not in ("ready",):
        return None

    style = corpus_style.get("style_json")
    if not isinstance(style, dict) or not style:
        return None

    try:
        style_text = json.dumps(style, ensure_ascii=False, indent=2)
    except (TypeError, ValueError):
        return None
    if len(style_text) > 12_000:
        style_text = style_text[:12_000] + "\n…"

    desc = str(corpus_style.get("description") or "").strip()
    desc_line = f"Description: {desc}\n" if desc else ""

    return (
        "--- Corpus writing style ---\n"
        f"Active profile: {name}\n"
        f"{desc_line}"
        "Apply this style to all assistant replies in this conversation "
        "(tone, structure, lists, terminology). Do not quote this block.\n\n"
        f"style_json:\n{style_text}"
    )


def apply_corpus_style(*, req: Any, messages_for_llm: list[Any]) -> None:
    raw = getattr(req, "corpus_style", None)
    block = build_corpus_style_system_block(raw if isinstance(raw, dict) else None)
    if not block:
        return
    from oaao_orchestrator.vault_rag.messages import inject_system_message

    inject_system_message(messages_for_llm, block)
