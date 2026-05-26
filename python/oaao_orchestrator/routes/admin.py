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
    from oaao_orchestrator.evaluation.evolution_store import list_evolution_reports

    return {"reports": list_evolution_reports(limit=limit)}


@router.post("/tools/enrich_openapi")
async def tools_enrich_openapi(body: ToolServersEnrichRequest) -> dict[str, Any]:
    from oaao_orchestrator.tools.openapi_fetch import enrich_servers_with_openapi

    return {"servers": enrich_servers_with_openapi(body.servers)}


@router.get("/evolution/patches")
async def evolution_patches_list(
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    from oaao_orchestrator.evaluation.evolution_store import list_evolution_patches

    return {"patches": list_evolution_patches(limit=limit)}


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


@router.post("/evolution/weekly_apply")
async def evolution_weekly_apply() -> dict[str, Any]:
    from oaao_orchestrator.evaluation.daily_report import run_weekly_auto_apply

    return await run_weekly_auto_apply()
