"""Version + build metadata API."""

from __future__ import annotations

from fastapi import APIRouter

from oaao_orchestrator.build_info import load_build_info, version_payload

router = APIRouter()


@router.get("/version")
async def version_info() -> dict[str, object]:
    return version_payload()


@router.get("/build_info")
async def build_info() -> dict[str, object]:
    return {"ok": True, **load_build_info()}
