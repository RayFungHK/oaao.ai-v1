"""W5-S1 — Liveness probe extracted from app.py."""

from __future__ import annotations

from fastapi import APIRouter

from oaao_orchestrator.build_info import version_payload

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, object]:
    base = version_payload(service="oaao_orchestrator")
    base["ok"] = True
    return base
