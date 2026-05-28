"""WS-1-S4 — ACCS gate and evolution patch recording."""

from __future__ import annotations

import json
import tempfile
from unittest.mock import AsyncMock, patch

import pytest

from oaao_orchestrator.evaluation.evolution_store import list_evolution_patches
from oaao_orchestrator.knowledge.asset_models import WebKnowledgeAssetV1, WebKnowledgeHitV1
from oaao_orchestrator.knowledge.asset_store import save_asset
from oaao_orchestrator.knowledge.promotion import (
    build_vault_markdown,
    hits_to_evidence,
    promote_web_knowledge_asset,
    web_knowledge_asset_id_from_pipeline,
)


@pytest.fixture
def asset_dirs(monkeypatch: pytest.MonkeyPatch) -> tempfile.TemporaryDirectory:
    tmp = tempfile.mkdtemp()
    monkeypatch.setenv("OAAO_KNOWLEDGE_ASSET_STORE_DIR", tmp)
    monkeypatch.setenv("OAAO_KNOWLEDGE_PROMOTION_ENABLED", "1")
    monkeypatch.setenv("OAAO_KNOWLEDGE_VAULT_INGEST", "0")
    monkeypatch.setenv("OAAO_KNOWLEDGE_ACCS_MIN", "0.5")
    return tmp  # type: ignore[return-value]


def test_hits_to_evidence() -> None:
    ev = hits_to_evidence([{"title": "A", "url": "https://a", "snippet": "body"}])
    assert ev[0]["excerpt"] == "body"
    assert ev[0]["source"] == "web_search"


def test_asset_id_from_pipeline_block() -> None:
    snap = {
        "blocks": [
            {"kind": "web_search", "props": {"asset_id": "wk_abc", "count": 2}},
        ]
    }
    assert web_knowledge_asset_id_from_pipeline(snap) == "wk_abc"


@pytest.mark.asyncio
async def test_promote_records_evolution_patch_when_accs_passes(asset_dirs: str) -> None:
    asset = WebKnowledgeAssetV1(
        asset_id="wk_testpromo001",
        scope="tenant",
        tenant_id=9,
        workspace_id=3,
        query="HKGX regulatory update 2026",
        content_hash="abc123",
        hits=[
            WebKnowledgeHitV1(
                title="Notice",
                url="https://example.com/n",
                snippet="The exchange published new margin rules for members.",
                plan_query="HKGX regulatory update",
            ),
        ],
    )
    save_asset(asset)

    digest = build_vault_markdown(asset)
    assert "HKGX" in digest

    with patch(
        "oaao_orchestrator.knowledge.promotion.score_accs",
        new_callable=AsyncMock,
    ) as mock_accs:
        from oaao_orchestrator.evaluation.accs import ACCSResult

        mock_accs.return_value = ACCSResult(
            score=0.82,
            factors={"alignment": 0.9, "accuracy": 0.85, "hallucination_penalty": 0.02},
            action="ship",
            source="test",
        )
        result = await promote_web_knowledge_asset(
            asset.asset_id,
            user_id=1,
            knowledge={"web_vault_id": 0},
        )

    assert result.promoted is True
    assert result.evolution_patch_id == f"wk-patch-{asset.asset_id}"
    patches = list_evolution_patches(limit=5)
    assert any(p.get("patch_id") == result.evolution_patch_id for p in patches)
    row = next(p for p in patches if p.get("patch_id") == result.evolution_patch_id)
    assert row.get("type") == "web_search_fewshot"
    assert json.loads(row.get("diff") or "{}").get("query")
