"""CS-2-S3 — Library convert stub (blocks from upload; heavy work in Python)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(prefix="/v1/library", tags=["library"])


class LibraryConvertRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


@router.post("/convert")
async def library_convert(
    req: LibraryConvertRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """
    Stub: accept locator/path hints; return minimal blocks + markdown mirror.
    Full docx/pdf heuristics ship in CS-2-S3 follow-up.
    """
    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    title = str(payload.get("title") or "Untitled").strip() or "Untitled"
    text = str(payload.get("text") or payload.get("source_text") or "").strip()
    blocks: list[dict[str, Any]] = []
    if text:
        for i, para in enumerate(text.split("\n\n")[:48]):
            chunk = para.strip()
            if not chunk:
                continue
            blocks.append(
                {
                    "id": f"b{i + 1}",
                    "type": "paragraph",
                    "content": chunk,
                }
            )
    if not blocks:
        blocks.append({"id": "b1", "type": "paragraph", "content": ""})

    return {
        "ok": True,
        "title": title,
        "blocks": blocks,
        "markdown": text or "",
        "revision": 1,
        "status": "stub_convert",
    }
