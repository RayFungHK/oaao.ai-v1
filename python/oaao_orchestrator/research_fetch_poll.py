"""Background poll for queued Article Research fetch jobs (throttled concurrency)."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.research.fetch_throttle import research_fetch_max_concurrent
from oaao_orchestrator.research.worker import (
    _finish_job,
    _known_hashes_from_items,
    _post_json,
    execute_claimed_fetch_job,
)

logger = logging.getLogger(__name__)

_worker_context_cache: dict[int, dict[str, Any]] = {}


def _research_api_base() -> str:
    base = (os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL") or "").strip().rstrip("/")
    if not base:
        return ""
    return base.replace("/vault/api", "") + "/research/api"


def _worker_urls() -> dict[str, str]:
    api = _research_api_base()
    vault_base = (os.environ.get("OAAO_VAULT_JOB_POLL_BASE_URL") or "").strip().rstrip("/")
    return {
        "vault_upload_url": vault_base + "/document_upload_text",
        "research_item_url": api + "/item_upsert",
        "fetch_job_claim_url": api + "/fetch_job_claim",
        "fetch_job_finish_url": api + "/fetch_job_finish",
        "fetch_job_worker_context_url": api + "/fetch_job_worker_context",
        "match_notify_url": api + "/match_notify",
    }


async def _load_worker_context(
    client: httpx.AsyncClient,
    context_url: str,
    watch_id: int,
) -> dict[str, Any]:
    cached = _worker_context_cache.get(watch_id)
    if cached is not None:
        return cached
    resp = await _post_json(client, context_url, {"watch_id": watch_id})
    ctx = resp if isinstance(resp, dict) and resp.get("success") else {}
    if ctx:
        _worker_context_cache[watch_id] = ctx
    return ctx


async def _poll_one_job(client: httpx.AsyncClient, urls: dict[str, str]) -> bool:
    """Claim and process one queued job. Returns True if a job was processed."""
    claim_url = urls.get("fetch_job_claim_url") or ""
    finish_url = urls.get("fetch_job_finish_url") or ""
    job_id = 0

    try:
        resp = await _post_json(client, claim_url, {})
        job = resp.get("job") if isinstance(resp, dict) else None
        if not isinstance(job, dict):
            return False

        job_id = int(job.get("job_id") or 0)
        url = str(job.get("canonical_url") or "").strip()
        watch_id = int(job.get("watch_id") or 0)
        if job_id < 1 or not url or watch_id < 1:
            if job_id > 0 and finish_url:
                await _finish_job(
                    client,
                    finish_url,
                    job_id=job_id,
                    status="failed",
                    error_text="invalid_job",
                )
            return False

        context_url = urls.get("fetch_job_worker_context_url") or ""
        ctx = await _load_worker_context(client, context_url, watch_id) if context_url else {}
        llm_cfg = ctx.get("summary_llm") if isinstance(ctx.get("summary_llm"), dict) else None
        match_llm_cfg = ctx.get("match_llm") if isinstance(ctx.get("match_llm"), dict) else llm_cfg
        known_hashes = _known_hashes_from_items(ctx.get("known_items"))

        status, err, _meta = await execute_claimed_fetch_job(
            client,
            job,
            upload_url=urls["vault_upload_url"],
            item_url=urls["research_item_url"],
            match_notify_url=urls.get("match_notify_url") or "",
            llm_cfg=llm_cfg,
            match_llm_cfg=match_llm_cfg,
            known_hashes=known_hashes,
        )
        if finish_url:
            await _finish_job(
                client,
                finish_url,
                job_id=job_id,
                status=status,
                error_text=(err or {}).get("error") if err else None,
            )
        _worker_context_cache.pop(watch_id, None)
        return True
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("research_fetch_poll error: %s", exc)
        if job_id > 0 and finish_url:
            try:
                await _finish_job(
                    client,
                    finish_url,
                    job_id=job_id,
                    status="failed",
                    error_text=str(exc)[:200],
                )
            except Exception as finish_exc:  # noqa: BLE001
                logger.warning("research_fetch_poll finish failed: %s", finish_exc)
        return False


async def _poll_worker(
    client: httpx.AsyncClient, urls: dict[str, str], idle_interval: float
) -> None:
    while True:
        worked = await _poll_one_job(client, urls)
        if not worked:
            await asyncio.sleep(idle_interval)


async def research_fetch_poll_loop() -> None:
    urls = _worker_urls()
    claim_url = urls.get("fetch_job_claim_url") or ""
    if not claim_url:
        logger.info("research_fetch_poll: OAAO_VAULT_JOB_POLL_BASE_URL unset — disabled")
        return

    idle_interval = float(os.environ.get("OAAO_RESEARCH_FETCH_POLL_INTERVAL_SEC", "3"))
    workers = research_fetch_max_concurrent()
    logger.info(
        "research_fetch_poll: enabled (%s) workers=%s idle_interval=%.1fs",
        claim_url,
        workers,
        idle_interval,
    )

    async with httpx.AsyncClient() as client:
        await asyncio.gather(*[_poll_worker(client, urls, idle_interval) for _ in range(workers)])
