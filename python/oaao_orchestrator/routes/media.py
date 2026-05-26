"""Internal media capability routes — registered python_module adapters + endpoint orchestration."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from oaao_orchestrator.media.capability_client import MediaCapabilityClient
from oaao_orchestrator.media.mm_python_module import normalize_module_id, run_module
from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(
    tags=["media"],
    dependencies=[Depends(require_internal_token)],
)


class MediaRunRequest(BaseModel):
    binding: dict[str, Any] = Field(default_factory=dict)
    task: str | None = None
    inputs: dict[str, Any] = Field(default_factory=dict)


@router.post("/v1/media/run")
async def media_run(body: MediaRunRequest) -> dict[str, Any]:
    client = MediaCapabilityClient()
    return await client.run(body.binding, task=body.task, inputs=body.inputs)


@router.post("/v1/media/lance/task")
async def lance_task_proxy(body: MediaRunRequest) -> dict[str, Any]:
    """Backward-compatible alias — resolves {@code mm_lance} via registry."""
    task = (body.task or body.binding.get("default_task") or "").strip()
    binding = dict(body.binding or {})
    binding.setdefault("backend", "python_module")
    binding["python_module"] = normalize_module_id(str(binding.get("python_module") or "mm_lance"))
    return await run_module(
        binding["python_module"],
        task=task,
        inputs=dict(body.inputs or {}),
        binding=binding,
    )
