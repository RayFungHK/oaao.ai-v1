"""W5-S1 phase 3 — `/v1/live/*` routes extracted from app.py.

Live-meeting endpoints (session lifecycle + WebSocket audio + SSE tail).
The internal token guard protects the JSON endpoints; the WebSocket and SSE
endpoints carry their own per-session stream-token validation, which mirrors
the original inline behaviour.

Endpoints:

- ``POST     /v1/live/session_start``        — mint a live session + tokens
- ``POST     /v1/live/session_stop``         — stop a live session
- ``WS       /v1/live/{session_id}/audio``   — bidirectional audio websocket
- ``GET      /v1/live/{session_id}/stream``  — SSE tail of session events

All delegate to ``oaao_orchestrator.live_meeting.*`` (lazy-imported so this
module stays cheap to import).
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(prefix="/v1/live", tags=["live"])


class LiveSessionStartRequest(BaseModel):
    cadence: str = "1v1"
    workspace_id: int | None = None
    user_id: int | None = None
    retention_mode: str = "disk_ttl"
    asr: dict[str, Any] | None = None
    asr_fallback: dict[str, Any] | None = None
    glossary: dict[str, Any] | None = None
    vault_retrieval_profiles: list[dict[str, Any]] | None = None
    embedding: dict[str, Any] | None = None
    vault_rag: dict[str, Any] | None = None


class LiveSessionStopRequest(BaseModel):
    session_id: str
    keep_audio: bool = False


def _orchestrator_public_base() -> str:
    raw = os.environ.get("OAAO_ORCHESTRATOR_PUBLIC_BASE", "").strip()
    if raw:
        return raw.rstrip("/")
    port = os.environ.get("OAAO_SIDECAR_PORT", "8103").strip() or "8103"
    return f"http://127.0.0.1:{port}"


@router.post("/session_start")
async def live_session_start(
    req: LiveSessionStartRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.live_meeting.hub import session_start_payload

    data = session_start_payload(
        cadence=req.cadence,
        retention_mode=req.retention_mode,
        workspace_id=req.workspace_id,
        user_id=req.user_id,
        public_base=_orchestrator_public_base(),
        asr_cfg=req.asr if isinstance(req.asr, dict) else None,
        asr_fallback_cfg=req.asr_fallback if isinstance(req.asr_fallback, dict) else None,
        glossary=req.glossary if isinstance(req.glossary, dict) else None,
        vault_retrieval_profiles=req.vault_retrieval_profiles
        if isinstance(req.vault_retrieval_profiles, list)
        else None,
        embedding=req.embedding if isinstance(req.embedding, dict) else None,
        vault_rag_config=req.vault_rag if isinstance(req.vault_rag, dict) else None,
    )
    return {"ok": True, "data": data}


@router.post("/session_stop")
async def live_session_stop(
    req: LiveSessionStopRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.live_meeting.hub import stop_session

    sid = (req.session_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id required")
    if not await stop_session(sid, keep_audio=bool(req.keep_audio)):
        raise HTTPException(status_code=404, detail="unknown_session")
    return {"ok": True, "session_id": sid, "keep_audio": bool(req.keep_audio)}


@router.websocket("/{session_id}/audio")
async def live_audio_websocket(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(""),
) -> None:
    from oaao_orchestrator.live_meeting.hub import handle_audio_websocket

    await handle_audio_websocket(websocket, session_id, token=token)


@router.get("/{session_id}/stream")
async def live_session_stream(
    session_id: str,
    token: str = Query(""),
    since_seq: int = Query(0, ge=0),
) -> StreamingResponse:
    """SSE tail for live meeting — ``live_transcript`` and system frames."""
    from oaao_orchestrator.live_meeting.hub import (
        get_session,
        subscribe_live_stream,
        validate_stream_token,
    )
    from oaao_orchestrator.live_meeting.sse_hub import get_live_stream
    from oaao_orchestrator.streaming.events import StreamEnvelope

    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="unknown_session")
    # W10-S1: reject callers without the per-session token minted at session_start.
    if not validate_stream_token(session_id, token):
        raise HTTPException(status_code=403, detail="bad_stream_token")

    hub = get_live_stream(session_id)
    if not hub.snapshot_since(since_seq):
        await hub.append(StreamEnvelope(phase="system", kind="status", text="live_meeting_ready"))

    async def gen():
        async for chunk in subscribe_live_stream(session_id, since_seq=since_seq):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
