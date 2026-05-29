"""UX-1 — Personalization survey wizard (internal, PHP bridge)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from oaao_orchestrator.personalization_wizard import (
    run_personalization_survey_finalize,
    run_personalization_survey_guided_step,
    run_personalization_survey_infer,
    run_personalization_survey_samples,
)
from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(prefix="/v1/personalization", tags=["personalization"])


class PersonalizationWizardRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


@router.post("/survey_samples")
async def personalization_survey_samples(
    req: PersonalizationWizardRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await run_personalization_survey_samples(payload)


@router.post("/survey_infer")
async def personalization_survey_infer(
    req: PersonalizationWizardRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await run_personalization_survey_infer(payload)


@router.post("/survey_guided")
async def personalization_survey_guided(
    req: PersonalizationWizardRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await run_personalization_survey_guided_step(payload)


@router.post("/survey_finalize")
async def personalization_survey_finalize(
    req: PersonalizationWizardRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await run_personalization_survey_finalize(payload)
