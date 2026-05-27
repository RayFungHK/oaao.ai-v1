"""Top-20 #9 phase 2 — vault ingest SSE (`GET /v1/vault/ingest/stream`)."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from oaao_orchestrator.routes._deps import require_internal_token
from oaao_orchestrator.stream_token import StreamTokenStore
from oaao_orchestrator.vault_ingest_status import fetch_vault_ingest_status

logger = logging.getLogger(__name__)

router = APIRouter(tags=["vault"])

_vault_ingest_tokens: StreamTokenStore = StreamTokenStore()


def _ingest_subject(user_id: int, vault_id: int) -> str:
    return f"vault_ingest:{max(0, user_id)}:{max(0, vault_id)}"


def _poll_interval_sec() -> float:
    raw = (os.environ.get("OAAO_VAULT_INGEST_SSE_POLL_SEC") or "2.5").strip()
    try:
        return max(0.5, min(15.0, float(raw)))
    except ValueError:
        return 2.5


def _keepalive_sec() -> float:
    raw = (os.environ.get("OAAO_SSE_KEEPALIVE_SEC") or "15").strip()
    try:
        return max(5.0, min(120.0, float(raw)))
    except ValueError:
        return 15.0


class VaultIngestStreamMintRequest(BaseModel):
    vault_id: int = Field(ge=1)
    user_id: int = Field(ge=1)
    workspace_id: int | None = Field(default=None, ge=1)


@router.post("/v1/vault/ingest/stream/mint")
async def mint_vault_ingest_stream_token(
    body: VaultIngestStreamMintRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    subject = _ingest_subject(body.user_id, body.vault_id)
    token = _vault_ingest_tokens.mint(subject, nbytes=24)
    return {
        "ok": True,
        "subject": subject,
        "token": token,
        "vault_id": body.vault_id,
        "user_id": body.user_id,
    }


@router.get("/v1/vault/ingest/stream")
async def vault_ingest_stream(
    vault_id: int = Query(..., ge=1),
    user_id: int = Query(..., ge=1),
    token: str = Query(...),
    document_ids: str = Query(""),
) -> StreamingResponse:
    subject = _ingest_subject(user_id, vault_id)
    if not _vault_ingest_tokens.validate(subject, token):
        raise HTTPException(status_code=403, detail="bad_stream_token")

    watch_ids: set[int] = set()
    if document_ids.strip():
        for part in document_ids.split(","):
            part = part.strip()
            if part.isdigit():
                n = int(part)
                if n > 0:
                    watch_ids.add(n)

    poll_sec = _poll_interval_sec()
    keepalive_sec = _keepalive_sec()

    async def gen():
        last_payload = ""
        idle_ticks = 0
        while True:
            payload = fetch_vault_ingest_status(
                vault_id,
                transient_only=True,
                document_ids=watch_ids or None,
            )
            if payload is None:
                frame = json.dumps({"error": "status_unavailable"}, ensure_ascii=False)
                yield f"event: error\ndata: {frame}\n\n"
                await asyncio.sleep(poll_sec)
                continue

            docs = payload.get("documents") if isinstance(payload.get("documents"), list) else []
            serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            if serialized != last_payload:
                last_payload = serialized
                yield f"event: status\ndata: {serialized}\n\n"
                idle_ticks = 0
            else:
                idle_ticks += 1
                if idle_ticks * poll_sec >= keepalive_sec:
                    yield "event: ping\ndata: {}\n\n"
                    idle_ticks = 0

            if not docs:
                yield "event: idle\ndata: {}\n\n"

            await asyncio.sleep(poll_sec)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
