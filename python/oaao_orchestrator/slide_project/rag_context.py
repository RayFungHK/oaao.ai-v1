"""Vault / web-search text for slide designer — outline and per-page LLM calls."""

from __future__ import annotations

from typing import Any

_VAULT_SYSTEM_MARKERS = (
    "optional vault excerpts",
    "vault retrieval found",
    "the user scoped vault sources",
    "answer from your general training knowledge",
)

_WEB_SEARCH_MARKER = "--- web search results ---"


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


def web_search_grounding_from_messages(
    messages: list[dict[str, Any]],
    *,
    max_chars: int = 14_000,
) -> str:
    """Recover web_search agent merge (``--- Web search results ---`` system block)."""
    chunks: list[str] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        if str(m.get("role") or "").lower() != "system":
            continue
        c = m.get("content")
        if not isinstance(c, str) or not c.strip():
            continue
        if _WEB_SEARCH_MARKER not in c.lower():
            continue
        body = c.strip()
        low = body.lower()
        start = low.index(_WEB_SEARCH_MARKER)
        chunks.append(body[start:].strip())
    if not chunks:
        return ""
    return "\n\n".join(chunks)[:max_chars]


def web_search_grounding_from_hits(
    hits: list[dict[str, Any]],
    *,
    max_chars: int = 14_000,
) -> str:
    """Format pipeline ``web_search_hits`` for slide LLM prompts."""
    if not hits:
        return ""
    lines = ["--- Web search results ---"]
    for i, h in enumerate(hits[:12], start=1):
        if not isinstance(h, dict):
            continue
        lines.append(
            f"[W{i}] {h.get('title', '')} — {h.get('url', '')}\n{h.get('snippet', '')}"
        )
    if len(lines) < 2:
        return ""
    return "\n\n".join(lines)[:max_chars]


def _chunk_present(needle: str, parts: list[str]) -> bool:
    n = (needle or "").strip().lower()[:120]
    if not n:
        return False
    for p in parts:
        if n in p.lower():
            return True
    return False


def resolve_slide_grounding_for_slides(
    messages: list[dict[str, Any]],
    *,
    explicit: str | None = None,
    pipeline_snap: dict[str, Any] | None = None,
    max_chars: int = 14_000,
) -> str:
    """Vault + web excerpts for slide outline / markdown / HTML LLM calls."""
    parts: list[str] = []
    if isinstance(explicit, str) and explicit.strip():
        parts.append(explicit.strip())

    vault = vault_grounding_from_messages(messages, max_chars=max_chars)
    if vault and not _chunk_present(vault, parts):
        parts.append(vault)

    web = web_search_grounding_from_messages(messages, max_chars=max_chars)
    if not web and isinstance(pipeline_snap, dict):
        hits = pipeline_snap.get("web_search_hits")
        if isinstance(hits, list):
            web = web_search_grounding_from_hits(hits, max_chars=max_chars)
    if web and not _chunk_present(web, parts):
        parts.append(web)

    combined = "\n\n".join(parts).strip()
    return combined[:max_chars] if combined else ""


def resolve_vault_grounding_for_slides(
    messages: list[dict[str, Any]],
    *,
    explicit: str | None = None,
    pipeline_snap: dict[str, Any] | None = None,
    max_chars: int = 14_000,
) -> str:
    """Backward-compatible alias — includes web search when present."""
    return resolve_slide_grounding_for_slides(
        messages,
        explicit=explicit,
        pipeline_snap=pipeline_snap,
        max_chars=max_chars,
    )


def merge_slide_grounding_into_ctx(
    run_ctx: Any,
    *,
    pipeline_snap: dict[str, Any] | None = None,
) -> None:
    """After web_search (or vault_rag), stash merged brief for slide_designer."""
    extra = getattr(run_ctx, "extra", None)
    if not isinstance(extra, dict):
        return
    explicit = extra.get("slide_grounding_for_slides") or extra.get("vault_grounding_for_slides")
    messages = list(getattr(run_ctx, "messages", None) or [])
    brief = resolve_slide_grounding_for_slides(
        messages,
        explicit=explicit if isinstance(explicit, str) else None,
        pipeline_snap=pipeline_snap,
    )
    if brief:
        extra["slide_grounding_for_slides"] = brief


def _grounding_block_label(grounding: str) -> str:
    low = grounding.lower()
    has_web = _WEB_SEARCH_MARKER in low
    has_vault = any(m in low for m in _VAULT_SYSTEM_MARKERS) or "vault excerpts" in low
    if has_web and has_vault:
        return "Research excerpts (primary source)"
    if has_web:
        return "Web search results (primary source)"
    return "Knowledge base (primary source)"


def slide_grounding_user_block(
    grounding: str,
    *,
    label: str | None = None,
) -> str:
    """Prompt section for slide LLM calls."""
    g = (grounding or "").strip()
    if not g:
        return ""
    lab = label or _grounding_block_label(g)
    if "web search" in lab.lower():
        rules = (
            "Use product specs, dates, and claims from the excerpts — do not invent facts. "
            "Do not substitute a generic platform/industry template when the user asked for a "
            "specific product or topic covered in the excerpts."
        )
    else:
        rules = (
            "Do not claim you cannot access the knowledge base or vault. "
            "Do not replace handbook content with a generic compliance or business template."
        )
    return (
        f"{lab} — use these excerpts as the PRIMARY factual basis. {rules}\n\n"
        f"{g}\n"
    )
