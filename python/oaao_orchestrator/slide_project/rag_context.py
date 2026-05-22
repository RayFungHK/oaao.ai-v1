"""Vault RAG text for slide designer — shared by outline and per-page slot LLM calls."""

from __future__ import annotations

import re
from typing import Any

_VAULT_SYSTEM_MARKERS = (
    "optional vault excerpts",
    "vault retrieval found",
    "the user scoped vault sources",
    "answer from your general training knowledge",
)


def vault_grounding_from_messages(
    messages: list[dict[str, Any]],
    *,
    max_chars: int = 14_000,
) -> str:
    """Recover vault RAG system injections when ``vault_grounding_for_slides`` was not set."""
    chunks: list[str] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        if str(m.get("role") or "").lower() != "system":
            continue
        c = m.get("content")
        if not isinstance(c, str) or not c.strip():
            continue
        low = c.lower()
        if any(mk in low for mk in _VAULT_SYSTEM_MARKERS):
            body = c.strip()
            if "---" in body:
                parts = body.split("---", 1)
                if len(parts) > 1 and len(parts[1].strip()) > 80:
                    chunks.append(parts[1].strip())
                else:
                    chunks.append(body)
            else:
                chunks.append(body)
    if not chunks:
        return ""
    return "\n\n".join(chunks)[:max_chars]


def resolve_vault_grounding_for_slides(
    messages: list[dict[str, Any]],
    *,
    explicit: str | None = None,
    max_chars: int = 14_000,
) -> str:
    """Prefer orchestrator-prepared brief; fall back to parsing chat messages."""
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()[:max_chars]
    return vault_grounding_from_messages(messages, max_chars=max_chars)


def slide_grounding_user_block(grounding: str, *, label: str = "Knowledge base (primary source)") -> str:
    """Prompt section for slide LLM calls."""
    g = (grounding or "").strip()
    if not g:
        return ""
    return (
        f"{label} — use these handbook/vault excerpts as the PRIMARY factual basis. "
        "Do not claim you cannot access the knowledge base or vault. "
        "Do not replace handbook content with a generic compliance or business template.\n\n"
        f"{g}\n"
    )
