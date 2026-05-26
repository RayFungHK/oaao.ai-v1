"""W5-S1 phase 8 — ``/v1/runs/chat`` ingress route.

Final phase of the app.py route split. The handler accepts a
``ChatRunRequest`` body, mints a run + stream token, and dispatches
``_run_llm_stream`` which awaits ``execute_chat_run`` in ``run_executor``.

The internal-token guard moves from an inline ``secrets.compare_digest``
block to the router-level ``require_internal_token`` dependency, matching
the pattern used by the other ``routes/*.py`` modules.
"""

from __future__ import annotations

import asyncio
import secrets
import uuid

from fastapi import APIRouter, Depends

from oaao_orchestrator.chat_models import ChatRunRequest
from oaao_orchestrator.routes._deps import require_internal_token
from oaao_orchestrator.streaming_state import _stream_tokens, registry

router = APIRouter(
    tags=["chat"],
    dependencies=[Depends(require_internal_token)],
)


async def _run_llm_stream(*, run_id: str, req: ChatRunRequest) -> None:
    from oaao_orchestrator.run_executor import execute_chat_run

    await execute_chat_run(run_id=run_id, req=req, registry=registry)


@router.post("/v1/runs/chat")
async def start_chat_run(req: ChatRunRequest) -> dict[str, str]:
    run_id = str(uuid.uuid4())
    registry.create(run_id)
    token = secrets.token_hex(24)
    _stream_tokens[run_id] = token

    asyncio.create_task(_run_llm_stream(run_id=run_id, req=req))  # noqa: RUF006

    return {"run_id": run_id, "stream_token": token}
