"""Inject conversation material bodies (prior RAG / deck MD) into run messages."""

from __future__ import annotations

from typing import Any

_MAX_BLOCK_CHARS = 14_000
_MAX_TOTAL_CHARS = 28_000


def _inject_system(messages: list[dict[str, Any]], content: str) -> None:
    if messages and str(messages[0].get("role") or "").lower() == "system":
        prev = messages[0].get("content")
        messages[0]["content"] = (
            f"{content}\n\n{prev}" if isinstance(prev, str) and prev.strip() else content
        )
    else:
        messages.insert(0, {"role": "system", "content": content})


def apply_conversation_material_grounding(
    messages: list[dict[str, Any]],
    blocks: list[dict[str, Any]] | None,
    *,
    reuse_turn: bool = False,
) -> int:
    """
    Prepend prior material container text (vault RAG brief, deck_outline.md, …).

    Returns number of blocks applied.
    """
    if not blocks:
        return 0

    parts: list[str] = []
    total = 0
    for raw in blocks:
        if not isinstance(raw, dict):
            continue
        body = str(raw.get("body") or "").strip()
        if not body:
            continue
        title = str(raw.get("title") or raw.get("material_id") or "Material").strip()
        mid = str(raw.get("material_id") or "").strip()
        kind = str(raw.get("kind") or "").strip()
        header = f"### {title}"
        if mid:
            header += f" (`{mid}`)"
        if kind:
            header += f" — {kind}"
        chunk = f"{header}\n\n{body[:_MAX_BLOCK_CHARS]}"
        if total + len(chunk) > _MAX_TOTAL_CHARS:
            remain = max(0, _MAX_TOTAL_CHARS - total - len(header) - 4)
            if remain < 80:
                break
            chunk = f"{header}\n\n{body[:remain]}"
        parts.append(chunk)
        total += len(chunk)
        if total >= _MAX_TOTAL_CHARS:
            break

    if not parts:
        return 0

    prefix = (
        "Conversation material container (prior turn outputs — use as grounding for this run). "
        "Do **not** claim you cannot access the user's vault or knowledge base when these excerpts are present."
    )
    if reuse_turn:
        prefix += (
            " This is a **continue / regenerate / retry** turn: treat these excerpts as the last known "
            "grounding; a fresh vault_rag step may still run to refresh passages."
        )
    _inject_system(messages, prefix + "\n\n" + "\n\n---\n\n".join(parts))
    return len(parts)
