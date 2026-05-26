"""W5-S1 phase 4 — `/v1/runs/*` (stateless) + `/v1/stream` routes.

Three endpoints relocated from ``app.py``:

- ``POST /v1/runs/{run_id}/agent_ask``  — resolve a pending agent-ask
- ``POST /v1/runs/{run_id}/cancel``     — request cancellation of a run
- ``GET  /v1/stream``                   — SSE subscribe to a run

``POST /v1/runs/chat`` is intentionally **not** moved here yet — it owns
the ``ChatRunRequest`` body model and dispatches ``_run_llm_stream`` which
both still live in ``app.py``. Once the LLM-stream loop is extracted
(Top-20 #6 phase 3), the chat endpoint can join this module too.

State sharing: ``registry`` (StreamSessionRegistry) and ``_stream_tokens``
are imported from ``streaming_state`` so this router and ``app.py`` see the
same singletons without a circular import.
"""

from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from oaao_orchestrator.agent_ask import ASK_DECISION_SKIP
from oaao_orchestrator.routes._deps import require_internal_token
from oaao_orchestrator.streaming_state import _stream_tokens, registry

router = APIRouter(tags=["runs"])


class AgentAskRequest(BaseModel):
    task_id: str = Field(min_length=1, max_length=128)
    decision: str = Field(description="proceed | skip | proceed_fork")


@router.post("/v1/runs/{run_id}/agent_ask")
async def resolve_agent_ask(
    run_id: str,
    body: AgentAskRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    run = registry.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="unknown_run")

    decision = (body.decision or "").strip().lower()
    if decision not in ("proceed", "skip", "proceed_fork"):
        raise HTTPException(
            status_code=400, detail="decision must be proceed, skip, or proceed_fork"
        )

    resolved = ASK_DECISION_SKIP if decision == "proceed_fork" else decision
    if not run.resolve_agent_ask(body.task_id.strip(), resolved):
        raise HTTPException(status_code=404, detail="no_pending_ask")

    return {"ok": True, "decision": decision}


@router.post("/v1/runs/{run_id}/cancel")
async def cancel_chat_run(
    run_id: str,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    run = registry.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="unknown_run")

    run.request_cancel()
    return {"ok": True, "run_id": run_id, "cancelled": True}


@router.get("/v1/stream")
async def subscribe_stream(
    run_id: str = Query(...),
    token: str = Query(...),
    since_seq: int = Query(0, ge=0),
) -> StreamingResponse:
    exp = _stream_tokens.get(run_id)
    if not exp or not secrets.compare_digest(exp, token):
        raise HTTPException(status_code=403, detail="bad_stream_token")

    run = registry.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="unknown_run")

    async def gen():
        async for chunk in run.subscribe(since_seq):
            yield chunk

    # Proxies (nginx) may buffer SSE unless explicitly disabled; keep
    # connection-alive hints for browsers.
    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
