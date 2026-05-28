"""CS-1-S6–S13 — Corpus Studio analyze, generate, template, render."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from oaao_orchestrator.routes._deps import require_internal_token

router = APIRouter(prefix="/v1/corpus", tags=["corpus"])


class CorpusAnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


@router.post("/analyze")
async def corpus_analyze(
    req: CorpusAnalyzeRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.corpus.jobs import start_corpus_analyze_job
    from oaao_orchestrator.corpus.worker import run_corpus_analyze

    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    background = bool(payload.get("background", True))
    job_id_hint = str(payload.get("analyze_job_id") or payload.get("job_id") or "").strip() or None

    if background:
        jid = await start_corpus_analyze_job(
            lambda: run_corpus_analyze(payload),
            job_id=job_id_hint,
        )
        return {"ok": True, "job_id": jid, "status": "running"}

    result = await run_corpus_analyze(payload)
    if not result.get("ok"):
        return result
    return {**result, "status": "done"}


@router.get("/jobs/{job_id}")
async def corpus_analyze_job(
    job_id: str,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.corpus.jobs import get_corpus_job

    job = await get_corpus_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="corpus_job_not_found")
    if job.status == "running":
        return {"ok": True, "job_id": job.job_id, "status": "running"}
    if job.status == "failed":
        return {
            "ok": False,
            "job_id": job.job_id,
            "status": "failed",
            "error": job.error or "corpus_analyze_failed",
            "detail": job.error or "corpus_analyze_failed",
        }
    return {"ok": True, "job_id": job.job_id, "status": "done", **(job.result or {})}


@router.post("/generate")
async def corpus_generate(
    req: CorpusAnalyzeRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    from oaao_orchestrator.corpus.generate_worker import run_corpus_generate
    from oaao_orchestrator.corpus.jobs import start_corpus_job

    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    background = bool(payload.get("background", True))
    job_id_hint = str(payload.get("generate_job_id") or payload.get("job_id") or "").strip() or None

    if background:
        jid = await start_corpus_job(
            lambda: run_corpus_generate(payload),
            job_id=job_id_hint,
        )
        return {"ok": True, "job_id": jid, "status": "running"}

    result = await run_corpus_generate(payload)
    if not result.get("ok"):
        return result
    return {**result, "status": "done"}


@router.post("/template/build")
async def corpus_template_build(
    req: CorpusAnalyzeRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """CS-1-S12 — (re)build corpus_html_template_v1 from segments + optional style_json."""
    from oaao_orchestrator.corpus.render_worker import run_corpus_template_build

    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    return await run_corpus_template_build(payload)


@router.post("/render")
async def corpus_render(
    req: CorpusAnalyzeRequest,
    _: None = Depends(require_internal_token),
) -> dict[str, Any]:
    """
    CS-1-S13 — Fill html_template parameters → HTML document; format=pdf returns skeleton until CS-3.
    Body: format (html|pdf), style_json | html_template, parameters{}, background?, job_id?
    """
    from oaao_orchestrator.corpus.jobs import start_corpus_job
    from oaao_orchestrator.corpus.render_worker import run_corpus_render

    payload = req.model_dump() if hasattr(req, "model_dump") else dict(req)
    background = bool(payload.get("background", True))
    job_id_hint = str(payload.get("render_job_id") or payload.get("job_id") or "").strip() or None

    if background:
        jid = await start_corpus_job(
            lambda: run_corpus_render(payload),
            job_id=job_id_hint,
        )
        return {"ok": True, "job_id": jid, "status": "running", "format": payload.get("format") or "html"}

    result = await run_corpus_render(payload)
    if not result.get("ok"):
        return result
    return {**result, "status": "done"}
