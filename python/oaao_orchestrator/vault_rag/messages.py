"""Vault RAG message / query helpers (W7-S2 phase 2)."""

from __future__ import annotations

from typing import Any


def _last_user_query(messages: list[dict[str, Any]]) -> str:
    for m in reversed(messages):
        if not isinstance(m, dict):
            continue
        if str(m.get("role") or "").lower() != "user":
            continue
        c = m.get("content")
        if isinstance(c, str) and c.strip():
            return c.strip()
    return ""


def _prior_user_queries(messages: list[dict[str, Any]], *, skip_last: bool = True) -> list[str]:
    """Earlier user turns (newest first), optionally skipping the latest user message."""
    out: list[str] = []
    skipped = not skip_last
    for m in reversed(messages):
        if not isinstance(m, dict):
            continue
        if str(m.get("role") or "").lower() != "user":
            continue
        c = m.get("content")
        if not isinstance(c, str) or not c.strip():
            continue
        if not skipped:
            skipped = True
            continue
        out.append(c.strip())
    return out


def _is_vault_rescan_query(query: str) -> bool:
    """True when the user asks to re-search vault without restating the topic (e.g. 再查一下 Vault)."""
    q = query.strip()
    if not q:
        return False
    low = q.lower()
    has_vault = (
        "vault" in low
        or "知識庫" in q
        or "知识库" in q
        or "知識库" in q
    )
    if not has_vault:
        return False
    rescan = any(
        token in low or token in q
        for token in (
            "再查",
            "重新查",
            "再搜",
            "重新搜",
            "再找找",
            "again",
            "recheck",
            "re-check",
        )
    )
    lookup = any(token in low or token in q for token in ("查", "搜", "找", "search", "check", "look"))
    short = len(q) <= 64
    return short and (rescan or lookup)


def _retrieval_query_from_messages(messages: list[dict[str, Any]]) -> str:
    """Embedding / relevance query — reuse prior user turn on vault re-scan follow-ups."""
    last = _last_user_query(messages)
    if not last:
        return ""
    if not _is_vault_rescan_query(last):
        return last
    for prior in _prior_user_queries(messages):
        if not _is_vault_rescan_query(prior):
            return prior
    return last


def _inject_system(messages: list[dict[str, Any]], content: str) -> None:
    if messages and str(messages[0].get("role") or "").lower() == "system":
        prev = messages[0].get("content")
        messages[0]["content"] = (
            f"{content}\n\n{prev}" if isinstance(prev, str) and prev.strip() else content
        )
    else:
        messages.insert(0, {"role": "system", "content": content})


def last_user_query(messages: list[dict[str, Any]]) -> str:
    """Public API — last user message text (HR-1)."""
    return _last_user_query(messages)


def retrieval_query_from_messages(messages: list[dict[str, Any]]) -> str:
    """Public API — query text for vault vector search (may reuse prior turn on re-scan)."""
    return _retrieval_query_from_messages(messages)


def is_vault_rescan_query(query: str) -> bool:
    """Public API — whether the user asked to re-search vault without restating the topic."""
    return _is_vault_rescan_query(query)


def inject_system_message(messages: list[dict[str, Any]], content: str) -> None:
    """Public API — prepend/merge system grounding block."""
    _inject_system(messages, content)
