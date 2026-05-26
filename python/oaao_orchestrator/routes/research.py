"""W5-S1 phase 2 — `/v1/research/*` routes extracted from app.py.

Five endpoints behind the shared X-OAAO-Internal-Token guard:

- ``POST /v1/research/run``                    — kick a research job
- ``POST /v1/research/match_prompt_normalize`` — normalize match prompt via LLM
- ``POST /v1/research/discover``               — discover research sources (one-shot)
- ``POST /v1/research/discover_step``          — incremental discover step
- ``POST /v1/research/discover_finalize``      — finalize discover source preview

All delegate to ``oaao_orchestrator.research.*`` (lazy-imported so this module
stays cheap to import).
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(prefix="/v1/research", tags=["research"])


class ResearchRunRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class ResearchMatchPromptRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class ResearchDiscoverRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class ResearchDiscoverStepRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class ResearchDiscoverFinalizeRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


@router.post("/run")
async def research_run(
    req: ResearchRunRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.research.worker import run_research_job

    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await run_research_job(payload)


@router.post("/match_prompt_normalize")
async def research_match_prompt_normalize(
    req: ResearchMatchPromptRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.research.match import normalize_match_prompt

    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    raw = str(payload.get("match_prompt") or "").strip()
    llm_cfg = payload.get("match_llm") if isinstance(payload.get("match_llm"), dict) else None
    if llm_cfg is None:
        llm_cfg = (
            payload.get("summary_llm") if isinstance(payload.get("summary_llm"), dict) else None
        )
    if not raw:
        return {"ok": False, "error": "match_prompt_required"}
    async with httpx.AsyncClient() as client:
        normalized = await normalize_match_prompt(client, raw, llm_cfg)
    return {"ok": True, "normalized_prompt": normalized}


@router.post("/discover")
async def research_discover(
    req: ResearchDiscoverRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.research.discover import discover_research_sources

    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await discover_research_sources(payload)


@router.post("/discover_step")
async def research_discover_step(
    req: ResearchDiscoverStepRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.research.discover_step import discover_research_step

    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    url = str(payload.get("url") or "").strip()
    if not url:
        return {"ok": False, "error": "url_required"}
    async with httpx.AsyncClient() as client:
        return await discover_research_step(
            client,
            url=url,
            depth=int(payload.get("depth") or 1),
            max_depth=int(payload.get("max_depth") or 3),
            parent_url=str(payload.get("parent_url") or "").strip() or None,
            llm_cfg=payload.get("llm_cfg") if isinstance(payload.get("llm_cfg"), dict) else None,
            use_llm=bool(payload.get("use_llm", True)),
            use_playwright=bool(payload.get("use_playwright")),
        )


@router.post("/discover_finalize")
async def research_discover_finalize(
    req: ResearchDiscoverFinalizeRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.research.discover_step import finalize_discover_source

    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    root_url = str(payload.get("root_url") or "").strip()
    if not root_url:
        return {"ok": False, "error": "root_url_required"}
    path = payload.get("path") if isinstance(payload.get("path"), list) else []
    selected = (
        payload.get("selected_article_urls")
        if isinstance(payload.get("selected_article_urls"), list)
        else []
    )
    src = finalize_discover_source(
        root_url=root_url,
        path=[p for p in path if isinstance(p, dict)],
        selected_article_urls=[str(u) for u in selected],
        final_index_url=str(payload.get("final_index_url") or "").strip() or None,
    )
    return {"ok": True, "source": src, "preview": {**src, "ok": True}}
