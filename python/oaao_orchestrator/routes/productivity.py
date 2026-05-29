"""CS-5 / CS-6 — Productivity agent sidecar endpoints (calendar planner, …)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from oaao_orchestrator.evaluation.calendar_event_planner import run_calendar_event_planner
from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(prefix="/v1/productivity", tags=["productivity"])


class CalendarPlanRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


@router.post("/calendar/plan")
async def productivity_calendar_plan(
    req: CalendarPlanRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """Condense calendar event fields before PHP ``calendar_events_save``."""
    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await run_calendar_event_planner(payload)
