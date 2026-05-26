"""W5-S1 — Admin endpoints (`/v1/admin/*`).

Extracted verbatim from `app.py` lines 560-718. Behaviour is preserved bit-for-
bit; only structural changes:

1. Inline `secrets.compare_digest` guard replaced by the
   `require_internal_token` FastAPI dependency (single source of truth).
2. Lazy `from oaao_orchestrator.* import …` calls inside handlers are retained
   (they exist to keep app startup cold-import-fast and break circular import
   risk with the evolution/crystallization modules).
3. `app.include_router(router)` from `app.py` mounts the routes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(
    prefix="/v1/admin",
    tags=["admin"],
    dependencies=[Depends(require_internal_token)],
)


class ToolServersEnrichRequest(BaseModel):
    servers: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/evolution/daily_report")
async def evolution_daily_report() -> dict[str, Any]:
    from oaao_orchestrator.evaluation.daily_report import run_daily_report
    from oaao_orchestrator.evaluation.evolution_collections import (
        ensure_evolution_collections,
    )

    await ensure_evolution_collections()
    return await run_daily_report()


@router.get("/evolution/reports")
async def evolution_reports_list(
    limit: int = Query(default=10, ge=1, le=50),
) -> dict[str, Any]:
    from oaao_orchestrator.evaluation.evolution_store import list_evolution_reports_merged

    return {"reports": await list_evolution_reports_merged(limit=limit)}


class EvolutionReportReview(BaseModel):
    status: str = Field(description="reviewed | dismissed | pending_review")


@router.post("/evolution/reports/{report_id}/review")
async def evolution_report_review(report_id: str, body: EvolutionReportReview) -> dict[str, Any]:
    from oaao_orchestrator.evaluation.evolution_store import update_evolution_report_persisted

    status = (body.status or "").strip().lower()
    if status not in ("reviewed", "dismissed", "pending_review"):
        raise HTTPException(status_code=400, detail="invalid_status")
    updated = await update_evolution_report_persisted(
        report_id,
        status=status,
        reviewed_at=datetime.now(UTC).isoformat(),
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="report_not_found")
    return {"report": updated}


@router.post("/tools/enrich_openapi")
async def tools_enrich_openapi(body: ToolServersEnrichRequest) -> dict[str, Any]:
    from oaao_orchestrator.tools.openapi_fetch import enrich_servers_with_openapi

    return {"servers": enrich_servers_with_openapi(body.servers)}


@router.get("/evolution/patches")
async def evolution_patches_list(
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    from oaao_orchestrator.evaluation.evolution_store import list_evolution_patches_merged

    return {"patches": await list_evolution_patches_merged(limit=limit)}


@router.get("/evolution/metrics/iqs_actions")
async def evolution_iqs_action_metrics(
    limit: int = Query(default=500, ge=1, le=5000),
) -> dict[str, Any]:
    from oaao_orchestrator.evaluation.evolution_store import iqs_action_distribution

    dist = iqs_action_distribution(limit=limit)
    return {"distribution": dist, "total": sum(dist.values())}


@router.post("/evolution/patches/{patch_id}/approve")
async def evolution_patch_approve(patch_id: str) -> dict[str, Any]:
    from oaao_orchestrator.evaluation.evolution_store import (
        get_evolution_patch,
        update_evolution_patch,
    )

    row = get_evolution_patch(patch_id)
    if row is None:
        raise HTTPException(status_code=404, detail="patch_not_found")
    updated = update_evolution_patch(
        patch_id,
        status="applied",
        approved_at=datetime.now(UTC).isoformat(),
    )
    return {"patch": updated}


@router.post("/evolution/rollback/{patch_id}")
async def evolution_patch_rollback(patch_id: str) -> dict[str, Any]:
    from oaao_orchestrator.evaluation.evolution_store import (
        get_evolution_patch,
        update_evolution_patch,
    )

    row = get_evolution_patch(patch_id)
    if row is None:
        raise HTTPException(status_code=404, detail="patch_not_found")
    updated = update_evolution_patch(
        patch_id,
        status="rolled_back",
        rolled_back_at=datetime.now(UTC).isoformat(),
    )
    return {
        "patch": updated,
        "note": "Status recorded — live prompt store rollback is manual until PHP wiring lands.",
    }


@router.get("/crystallization/stats")
async def crystallization_stats_endpoint() -> dict[str, Any]:
    from oaao_orchestrator.crystallization.bootstrap import crystallization_stats

    return crystallization_stats()


@router.get("/crystallization/skills")
async def crystallization_skills_list(
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    from oaao_orchestrator.crystallization.sealer import memory_skills_for_tests

    skills = list(memory_skills_for_tests().values())[:limit]
    return {
        "skills": [s.model_dump(mode="json") for s in skills],
        "count": len(skills),
    }


@router.post("/crystallization/lru_evict")
async def crystallization_lru_evict(
    dry_run: bool = Query(default=False),
) -> dict[str, Any]:
    from oaao_orchestrator.crystallization.lru import evict_stale_crystallized_skills

    return await evict_stale_crystallized_skills(dry_run=dry_run)


@router.post("/evolution/weekly_apply")
async def evolution_weekly_apply() -> dict[str, Any]:
    from oaao_orchestrator.crystallization.collections import ensure_crystallized_collections
    from oaao_orchestrator.evaluation.daily_report import run_weekly_auto_apply
    from oaao_orchestrator.evaluation.evolution_collections import ensure_evolution_collections

    await ensure_evolution_collections()
    await ensure_crystallized_collections()
    return await run_weekly_auto_apply()
