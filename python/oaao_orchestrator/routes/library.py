"""CS-2-S3/S7 — Library convert, embed, and Soft-RAG search."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from oaao_orchestrator.library.ai_transform import run_library_ai_transform
from oaao_orchestrator.library.convert import convert_payload_to_blocks
from oaao_orchestrator.library.embed import run_library_embed
from oaao_orchestrator.library.search import run_library_search
from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(prefix="/v1/library", tags=["library"])


class LibraryConvertRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class LibraryEmbedRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class LibrarySearchRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class LibraryAiTransformRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


@router.post("/convert")
async def library_convert(
    req: LibraryConvertRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """Text or uploaded file (absolute_path + mime_type) → blocks via vault extractors."""
    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    title = str(payload.get("title") or "Untitled").strip() or "Untitled"
    blocks, markdown, status = convert_payload_to_blocks(payload)

    return {
        "ok": True,
        "title": title,
        "blocks": blocks,
        "markdown": markdown,
        "revision": 1,
        "status": status,
    }


@router.post("/embed")
async def library_embed(
    req: LibraryEmbedRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """CS-2-S7 — chunk + embed library document into ``library_{tenant_id}`` Qdrant collection."""
    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await run_library_embed(payload)


@router.post("/search")
async def library_search(
    req: LibrarySearchRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """CS-2-S7 — tenant-scoped vector search; optional ``document_ids`` for attach-only recall."""
    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await run_library_search(payload)


@router.post("/ai/transform")
async def library_ai_transform(
    req: LibraryAiTransformRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """CS-2-S5 — rewrite / expand / summarize editor selection."""
    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await run_library_ai_transform(payload)
