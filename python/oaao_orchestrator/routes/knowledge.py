"""EPIC-WS-1 — global knowledge (platform / tenant) orientation + search plane."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(prefix="/v1/knowledge", tags=["knowledge"])


class OrientationUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    scope: str | None = Field(default=None, description="platform | tenant")
    tenant_id: int | None = Field(default=None, ge=1)
    workspace_id: int | None = Field(default=None, ge=1)
    conversation_id: str | None = None
    messages: list[dict[str, Any]] = Field(default_factory=list)
    llm_cfg: dict[str, Any] | None = None
    corpus_style: dict[str, Any] | None = None


def _scope_ref_from_body(req: OrientationUpdateRequest):
    from oaao_orchestrator.knowledge.scope import KnowledgeScopeRef

    forced = (req.scope or "platform").strip().lower()
    if forced == "platform":
        return KnowledgeScopeRef(scope="platform", workspace_id=req.workspace_id)
    if req.tenant_id is None or req.tenant_id < 1:
        raise HTTPException(status_code=422, detail="tenant_id_required")
    return KnowledgeScopeRef(
        scope="tenant",
        tenant_id=req.tenant_id,
        workspace_id=req.workspace_id,
    )


@router.post("/orientation/update")
async def orientation_update(
    req: OrientationUpdateRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.knowledge.orientation_worker import (
        update_orientation_from_messages,
    )

    scope_ref = _scope_ref_from_body(req)
    result = await update_orientation_from_messages(
        scope_ref=scope_ref,
        messages=req.messages,
        conversation_id=req.conversation_id,
        llm_cfg=req.llm_cfg,
        corpus_style=req.corpus_style,
    )
    if result is None:
        raise HTTPException(
            status_code=422,
            detail="orientation_update_failed_or_no_transcript",
        )
    return {
        "ok": True,
        "scope": result.scope,
        "tenant_id": result.tenant_id,
        "workspace_id": result.workspace_id,
        "method": result.method,
        "orientation": result.orientation.model_dump(),
        "effective_orientation": (
            result.effective_orientation.model_dump()
            if result.effective_orientation
            else None
        ),
    }


@router.get("/orientation/platform")
async def orientation_get_platform(
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.knowledge.orientation_store import load_orientation_platform

    row = load_orientation_platform()
    if row is None:
        raise HTTPException(status_code=404, detail="orientation_not_found")
    return {"ok": True, "scope": "platform", "orientation": row.model_dump()}


@router.get("/orientation/tenant/{tenant_id}")
async def orientation_get_tenant(
    tenant_id: int,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.knowledge.orientation_store import load_orientation_tenant

    row = load_orientation_tenant(tenant_id)
    if row is None:
        raise HTTPException(status_code=404, detail="orientation_not_found")
    return {"ok": True, "scope": "tenant", "tenant_id": tenant_id, "orientation": row.model_dump()}


@router.get("/orientation/effective")
async def orientation_get_effective(
    tenant_id: int | None = Query(default=None, ge=1),
    workspace_id: int | None = Query(default=None, ge=1),
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.knowledge.orientation_store import load_effective_orientation

    row = load_effective_orientation(tenant_id=tenant_id, workspace_id=workspace_id)
    if row is None:
        raise HTTPException(status_code=404, detail="orientation_not_found")
    return {
        "ok": True,
        "tenant_id": tenant_id,
        "workspace_id": workspace_id,
        "orientation": row.model_dump(),
    }


@router.get("/orientation/{workspace_id}")
async def orientation_get_legacy_workspace(
    workspace_id: int,
    tenant_id: int | None = Query(default=None, ge=1),
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """Legacy path — returns **effective** tenant⊕platform orientation (not ws-only file)."""
    from oaao_orchestrator.knowledge.orientation_store import load_effective_orientation

    row = load_effective_orientation(tenant_id=tenant_id, workspace_id=workspace_id)
    if row is None:
        raise HTTPException(status_code=404, detail="orientation_not_found")
    return {"ok": True, "orientation": row.model_dump(), "deprecated": "use /orientation/effective"}


class SearchPlanRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    tenant_id: int | None = Field(default=None, ge=1)
    workspace_id: int | None = Field(default=None, ge=1)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    knowledge: dict[str, Any] | None = None
    llm_cfg: dict[str, Any] | None = None


@router.post("/search/plan")
async def search_plan_build(
    req: SearchPlanRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.knowledge.search_plan import build_search_plan

    plan = await build_search_plan(
        tenant_id=req.tenant_id,
        workspace_id=req.workspace_id,
        messages=req.messages,
        knowledge=req.knowledge,
        llm_cfg=req.llm_cfg,
    )
    return {"ok": True, "plan": plan}


class AssetPromoteRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    user_id: int | None = Field(default=None, ge=1)
    knowledge: dict[str, Any] | None = None
    coach_endpoint: dict[str, Any] | None = None
    assistant_text: str | None = None


@router.post("/assets/{asset_id}/promote")
async def knowledge_asset_promote(
    asset_id: str,
    req: AssetPromoteRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.knowledge.asset_store import load_asset
    from oaao_orchestrator.knowledge.promotion import promote_web_knowledge_asset

    asset = load_asset(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="asset_not_found")
    result = await promote_web_knowledge_asset(
        asset_id,
        user_id=req.user_id,
        knowledge=req.knowledge,
        coach_endpoint=req.coach_endpoint,
        assistant_text=req.assistant_text,
        workspace_id=asset.workspace_id,
    )
    return {
        "ok": True,
        "promoted": result.promoted,
        "reason": result.reason,
        "accs_score": result.accs_score,
        "vault_document_id": result.vault_document_id,
        "evolution_patch_id": result.evolution_patch_id,
        "scope": asset.scope,
        "tenant_id": asset.tenant_id,
    }


@router.get("/assets/tenant/{tenant_id}")
async def knowledge_assets_list_tenant(
    tenant_id: int,
    limit: int = 50,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.knowledge.asset_store import list_tenant_assets

    rows = list_tenant_assets(tenant_id, limit=max(1, min(limit, 100)))
    return {
        "ok": True,
        "scope": "tenant",
        "tenant_id": tenant_id,
        "assets": [r.model_dump() for r in rows],
    }


@router.get("/assets/platform")
async def knowledge_assets_list_platform(
    limit: int = 50,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.knowledge.asset_store import list_platform_assets

    rows = list_platform_assets(limit=max(1, min(limit, 100)))
    return {"ok": True, "scope": "platform", "assets": [r.model_dump() for r in rows]}


class KnowledgeRefreshRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    scope: str | None = Field(default=None, description="platform | tenant | all")
    tenant_id: int | None = Field(default=None, ge=1)
    workspace_id: int | None = Field(default=None, ge=1)
    force: bool = False
    classify_after: bool = False
    user_id: int | None = Field(default=None, ge=1)
    knowledge: dict[str, Any] | None = None


class KnowledgeSignalsMergeRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    topics: list[dict[str, Any]] = Field(default_factory=list)
    lookback_days: int | None = Field(default=None, ge=1, le=90)


@router.post("/signals/merge")
async def knowledge_signals_merge(
    req: KnowledgeSignalsMergeRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """WS-1-S11 — batch conversation importance → platform topic_signals."""
    from oaao_orchestrator.knowledge.conversation_signals import (
        merge_conversation_signal_batch,
    )

    return merge_conversation_signal_batch(
        req.topics,
        lookback_days=req.lookback_days,
    )


@router.post("/refresh")
async def knowledge_refresh(
    req: KnowledgeRefreshRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """WS-1-S5 — orientation-driven scheduled web search into Knowledge buckets."""
    from oaao_orchestrator.knowledge.refresh_worker import run_knowledge_refresh_batch

    return await run_knowledge_refresh_batch(
        tenant_id=req.tenant_id,
        scope=req.scope,
        force=req.force,
        knowledge=req.knowledge,
        user_id=req.user_id,
        classify_after=req.classify_after,
    )


class KnowledgeClassifyRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    knowledge: dict[str, Any] | None = None
    classify_llm_cfg: dict[str, Any] | None = None
    distill_llm_cfg: dict[str, Any] | None = None


@router.post("/assets/{asset_id}/classify")
async def knowledge_asset_classify(
    asset_id: str,
    req: KnowledgeClassifyRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """WS-1-S9 — classify + distill one bucket entry."""
    from oaao_orchestrator.knowledge.distill_worker import classify_and_distill_asset

    return await classify_and_distill_asset(
        asset_id,
        knowledge=req.knowledge,
        classify_llm_cfg=req.classify_llm_cfg,
        distill_llm_cfg=req.distill_llm_cfg,
    )


class KnowledgeClassifyBatchRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    tenant_id: int | None = Field(default=None, ge=1)
    limit: int = Field(default=20, ge=1, le=50)
    knowledge: dict[str, Any] | None = None


@router.post("/assets/classify-batch")
async def knowledge_assets_classify_batch(
    req: KnowledgeClassifyBatchRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.knowledge.distill_worker import classify_distill_pending_assets

    return await classify_distill_pending_assets(
        tenant_id=req.tenant_id,
        knowledge=req.knowledge,
        limit=req.limit,
    )


@router.get("/recall/context")
async def knowledge_recall_context(
    tenant_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=6, ge=1, le=20),
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """WS-1-S8 — distilled bucket excerpts for non-Vault consumers."""
    from oaao_orchestrator.knowledge.distill_worker import list_bucket_assets_for_recall
    from oaao_orchestrator.knowledge.recall import build_knowledge_bucket_recall_block

    rows = list_bucket_assets_for_recall(tenant_id=tenant_id, limit=limit)
    block = build_knowledge_bucket_recall_block(tenant_id=tenant_id, limit=limit)
    return {
        "ok": True,
        "tenant_id": tenant_id,
        "block": block,
        "assets": [
            {
                "asset_id": a.asset_id,
                "query": a.query,
                "tier": a.tier,
                "distilled_summary": (a.meta or {}).get("distilled_summary"),
                "bucket_lane": (a.meta or {}).get("bucket_lane"),
            }
            for a in rows
        ],
    }


@router.get("/assets/by-workspace/{workspace_id}")
async def knowledge_assets_list_by_workspace(
    workspace_id: int,
    limit: int = 50,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """Attribution filter over tenant/platform catalogs."""
    from oaao_orchestrator.knowledge.asset_store import list_workspace_assets

    rows = list_workspace_assets(workspace_id, limit=max(1, min(limit, 100)))
    return {
        "ok": True,
        "workspace_id": workspace_id,
        "assets": [r.model_dump() for r in rows],
    }
