"""W5-S1 phase 2 — `/v1/mine/*` routes extracted from app.py.

Two endpoints behind the shared X-OAAO-Internal-Token guard:

- ``POST /v1/mine/run``      — kick a mine job
- ``POST /v1/mine/discover`` — discover mine sources

Both delegate to ``oaao_orchestrator.mine.*`` (lazy-imported so this module
stays cheap to import).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(prefix="/v1/mine", tags=["mine"])


class MineRunRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class MineDiscoverRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


@router.post("/run")
async def mine_run(
    req: MineRunRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.mine.worker import run_mine_job

    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await run_mine_job(payload)


@router.post("/discover")
async def mine_discover(
    req: MineDiscoverRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.mine.discover import discover_mine_sources

    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await discover_mine_sources(payload)
