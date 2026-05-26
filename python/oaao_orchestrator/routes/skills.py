"""W5-S1 phase 7 — ``/v1/skills/discover``.

LLM-driven matcher: given a user turn + skills catalog, returns either a
catalog match or a new conversation-skill proposal (markdown preview).

Extracted from ``app.py``; the internal-token guard moves from an inline
``secrets.compare_digest`` block to the router-level
``require_internal_token`` dependency. ``_resolve_api_key`` is shared with
``app.py`` (and the still-resident ``/v1/runs/chat`` handler) via
``oaao_orchestrator.endpoint_keys``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from oaao_orchestrator.endpoint_keys import resolve_api_key
from oaao_orchestrator.routes._deps import require_internal_token
from oaao_orchestrator.routes._shared_models import EndpointPayload

router = APIRouter(
    tags=["skills"],
    dependencies=[Depends(require_internal_token)],
)


class SkillsDiscoverRequest(BaseModel):
    user_message: str = ""
    conversation_excerpt: str = ""
    skills_catalog: list[dict[str, Any]] = Field(default_factory=list)
    endpoint: EndpointPayload


@router.post("/v1/skills/discover")
async def skills_discover(body: SkillsDiscoverRequest) -> dict[str, Any]:
    """LLM: match user turn to catalog skills or suggest a new conversation skill (markdown preview)."""
    from oaao_orchestrator.micro_skills import (
        catalog_from_request,
        discover_skills_llm,
    )

    class _CatReq:
        skills_catalog = body.skills_catalog

    catalog = catalog_from_request(_CatReq())
    api_key = resolve_api_key(body.endpoint)
    base = (body.endpoint.base_url or "").rstrip("/")
    result = await discover_skills_llm(
        url=f"{base}/chat/completions" if base else "",
        api_key=api_key,
        model=body.endpoint.model,
        user_message=body.user_message,
        catalog=catalog,
        conversation_excerpt=body.conversation_excerpt,
    )
    return {"ok": True, **result}
