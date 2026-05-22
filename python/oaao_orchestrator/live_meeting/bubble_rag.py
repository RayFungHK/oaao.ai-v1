"""Vault RAG lookup for live-meeting bubble taps (no chat RunExecutor)."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from oaao_orchestrator.vault_graph_rag import VaultRagCitation, augment_chat_messages_for_vault_rag


def _citation_material(c: VaultRagCitation) -> dict[str, Any]:
    row = asdict(c)
    excerpt = str(row.get("excerpt") or "").strip()
    if len(excerpt) > 480:
        row["excerpt"] = excerpt[:477] + "…"
    return row


async def lookup_bubble_vault(
    query: str,
    *,
    vault_retrieval_profiles: list[dict[str, Any]] | None,
    embedding: dict[str, Any] | None = None,
    vault_rag: dict[str, Any] | None = None,
    vault_auto_rag: bool = True,
) -> dict[str, Any]:
    """Run vault retrieval for a bubble label; returns materials for ``live_materials`` SSE."""
    q = (query or "").strip()
    if not q:
        return {"passage_count": 0, "profile_hits": 0, "materials": [], "activity_lines": []}

    messages: list[dict[str, Any]] = [{"role": "user", "content": q}]
    outcome = await augment_chat_messages_for_vault_rag(
        messages,
        vault_retrieval_profiles,
        embedding=embedding,
        vault_auto_rag=vault_auto_rag,
        vault_rag=vault_rag,
    )
    materials = [_citation_material(c) for c in outcome.citation_refs[:8]]
    return {
        "passage_count": outcome.passage_count,
        "profile_hits": outcome.profile_hits,
        "materials": materials,
        "activity_lines": list(outcome.activity_lines),
        "detail_lines": list(outcome.detail_lines),
    }
