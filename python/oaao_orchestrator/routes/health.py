"""W5-S1 — Liveness probe extracted from app.py."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, bool | str]:
    return {"ok": True, "service": "oaao_orchestrator"}
