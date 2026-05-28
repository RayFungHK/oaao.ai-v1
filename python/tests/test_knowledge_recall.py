"""WS-1-S8 — knowledge vault profile merge."""

from __future__ import annotations

from oaao_orchestrator.knowledge.recall import (
    knowledge_vault_ids_for_recall,
    merge_knowledge_recall_profiles,
)


def test_merge_recall_profiles_from_knowledge_dict() -> None:
    profiles = [{"vault_id": 10, "qdrant_collection": "t_ws_1"}]
    knowledge = {
        "tenant_vault_id": 99,
        "recall_vault_profiles": [
            {"vault_id": 99, "qdrant_collection": "acme_global", "vault_name": "Knowledge"},
        ],
    }
    merged = merge_knowledge_recall_profiles(profiles, knowledge=knowledge, tenant_id=1)
    assert any(int(p.get("vault_id") or 0) == 99 for p in merged)
    assert any(int(p.get("vault_id") or 0) == 10 for p in merged)


def test_knowledge_vault_ids_env_fallback(monkeypatch) -> None:
    monkeypatch.setenv("OAAO_KNOWLEDGE_TENANT_VAULT_ID", "42")
    ids = knowledge_vault_ids_for_recall(knowledge={"tenant_id": 1}, tenant_id=1)
    assert 42 in ids


def test_merge_opt_out() -> None:
    knowledge = {"merge_recall": False, "tenant_vault_id": 99}
    merged = merge_knowledge_recall_profiles([], knowledge=knowledge)
    assert merged == []
