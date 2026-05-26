"""W5-S1 phase 5 — Turn-score + work-queue admin endpoints.

Extracted verbatim from ``app.py`` lines 580-712. All three endpoints are
internal-token-gated; the guard is enforced via the shared
``require_internal_token`` dependency declared at router level so each handler
body stays focused on the rescore / status payload.

- ``POST /v1/turn_scores/rescore`` — schedule per-turn IQS/ACCS rescoring.
- ``GET  /v1/turn_scores/versions`` — return scorer-version manifest.
- ``GET  /v1/work_queues/status``  — return work-queue status snapshot.

The ``_normalize_score_dims`` helper plus ``TurnScoreRescoreTurn`` /
``TurnScoreRescoreRequest`` Pydantic models are private to this module (only
referenced by the rescore handler in app.py prior to extraction).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, field_validator

from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(
    tags=["turn-scores"],
    dependencies=[Depends(require_internal_token)],
)


def _normalize_score_dims(raw: dict[str, Any] | list[Any] | None) -> dict[str, float]:
    """Drop null / non-numeric dim values — PHP JSON may send [] instead of {}."""
    if raw is None or isinstance(raw, list):
        raw = {}
    out: dict[str, float] = {}
    for key, val in raw.items():
        if isinstance(val, bool):
            continue
        if isinstance(val, (int, float)):
            out[str(key)] = float(val)
        elif isinstance(val, str) and val.strip():
            try:
                out[str(key)] = float(val)
            except ValueError:
                continue
    return out


class TurnScoreRescoreTurn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    assistant_message_id: int = Field(ge=1)
    turn_index: int = Field(ge=1)
    user_message: str = ""
    assistant_content: str = ""
    conversation_history: list[dict[str, Any]] = Field(default_factory=list)
    pipeline_snap: dict[str, Any] | None = None
    stored_version: str = ""
    iqs: float = 0.0
    accs: float = 0.0
    iqs_dims: dict[str, Any] = Field(default_factory=dict)
    accs_dims: dict[str, Any] = Field(default_factory=dict)
    iqs_action: str = ""
    needs_iqs: bool = True
    needs_accs: bool = True

    @field_validator("iqs_dims", "accs_dims", mode="before")
    @classmethod
    def _coerce_dims_mapping(cls, value: Any) -> Any:
        if value is None or value == []:
            return {}
        if isinstance(value, list):
            return {}
        return value


class TurnScoreRescoreRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    conversation_id: int = Field(ge=1)
    turns: list[TurnScoreRescoreTurn] = Field(default_factory=list)
    coach_endpoint: dict[str, Any] | None = None


@router.post("/v1/turn_scores/rescore")
async def turn_scores_rescore(body: TurnScoreRescoreRequest) -> dict[str, Any]:
    from oaao_orchestrator.evaluation.scorer_version import scorer_versions_payload
    from oaao_orchestrator.evaluation.turn_score_backfill import (
        TurnRescoreItem,
        try_schedule_conversation_rescore,
    )

    items: list[TurnRescoreItem] = []
    for raw in body.turns:
        item = TurnRescoreItem(
            assistant_message_id=int(raw.assistant_message_id),
            turn_index=int(raw.turn_index),
            user_message=str(raw.user_message or ""),
            assistant_content=str(raw.assistant_content or ""),
            conversation_history=list(raw.conversation_history or []),
            pipeline_snap=raw.pipeline_snap if isinstance(raw.pipeline_snap, dict) else None,
            stored_version=str(raw.stored_version or ""),
            iqs=float(raw.iqs),
            accs=float(raw.accs),
            iqs_dims=_normalize_score_dims(raw.iqs_dims),
            accs_dims=_normalize_score_dims(raw.accs_dims),
            iqs_action=str(raw.iqs_action or ""),
            needs_iqs=bool(raw.needs_iqs),
            needs_accs=bool(raw.needs_accs),
        )
        if (item.needs_iqs or item.needs_accs) and item.assistant_content.strip():
            items.append(item)

    if not items:
        return {"ok": True, "queued": 0, "scorer_versions": scorer_versions_payload()}

    queued = await try_schedule_conversation_rescore(
        conversation_id=int(body.conversation_id),
        turns=items,
        coach_endpoint=body.coach_endpoint if isinstance(body.coach_endpoint, dict) else None,
    )
    return {
        "ok": True,
        "queued": len(items) if queued else 0,
        "already_running": not queued,
        "scorer_versions": scorer_versions_payload(),
    }


@router.get("/v1/turn_scores/versions")
async def turn_scores_versions() -> dict[str, Any]:
    from oaao_orchestrator.evaluation.scorer_version import scorer_versions_payload

    return {"ok": True, "scorer_versions": scorer_versions_payload()}


@router.get("/v1/work_queues/status")
async def work_queues_status() -> dict[str, Any]:
    from oaao_orchestrator.evaluation.work_queue_status import (
        work_queues_status_payload,
    )

    return {"ok": True, **work_queues_status_payload()}
