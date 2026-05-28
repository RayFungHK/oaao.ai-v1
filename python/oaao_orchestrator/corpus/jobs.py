"""In-memory background jobs for corpus analyze + generate (CS-1-S6–S9)."""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

_JOB_TTL_SEC = 3600
_MAX_JOBS = 64


@dataclass
class CorpusJob:
    job_id: str
    status: str  # running | done | failed
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)


_jobs: dict[str, CorpusJob] = {}
_jobs_lock = asyncio.Lock()


def _sync_job_to_disk(job: CorpusJob) -> None:
    from oaao_orchestrator.corpus.job_store import persist_job

    persist_job(job)


def _prune_jobs_locked() -> None:
    now = time.time()
    stale = [jid for jid, job in _jobs.items() if now - job.created_at > _JOB_TTL_SEC]
    for jid in stale:
        _jobs.pop(jid, None)
    if len(_jobs) <= _MAX_JOBS:
        return
    ordered = sorted(_jobs.items(), key=lambda item: item[1].created_at)
    for jid, _ in ordered[: len(_jobs) - _MAX_JOBS]:
        _jobs.pop(jid, None)


async def start_corpus_job(
    runner: Callable[[], Awaitable[dict[str, Any]]],
    job_id: str | None = None,
) -> str:
    jid = (job_id or "").strip() or f"can-{uuid.uuid4().hex[:12]}"
    job = CorpusJob(job_id=jid, status="running")
    async with _jobs_lock:
        _prune_jobs_locked()
        _jobs[jid] = job
    _sync_job_to_disk(job)

    async def _run() -> None:
        try:
            payload = await runner()
            async with _jobs_lock:
                stored = _jobs.get(jid)
                if stored is None:
                    return
                if isinstance(payload, dict) and payload.get("ok") is False:
                    stored.status = "failed"
                    stored.error = str(payload.get("error") or payload.get("detail") or "corpus_analyze_failed")
                    stored.result = payload
                else:
                    stored.status = "done"
                    stored.result = payload
                _sync_job_to_disk(stored)
        except Exception as exc:  # noqa: BLE001
            async with _jobs_lock:
                stored = _jobs.get(jid)
                if stored is None:
                    return
                stored.status = "failed"
                stored.error = str(exc) or exc.__class__.__name__
                _sync_job_to_disk(stored)

    asyncio.create_task(_run())  # noqa: RUF006
    return jid


async def get_corpus_job(job_id: str) -> CorpusJob | None:
    jid = job_id.strip()
    async with _jobs_lock:
        hit = _jobs.get(jid)
        if hit is not None:
            return hit
    from oaao_orchestrator.corpus.job_store import load_job, prune_job_store

    prune_job_store()
    disk = load_job(jid)
    if disk is not None:
        async with _jobs_lock:
            _jobs[jid] = disk
        return disk
    return None


async def start_corpus_analyze_job(
    runner: Callable[[], Awaitable[dict[str, Any]]],
    job_id: str | None = None,
) -> str:
    return await start_corpus_job(runner, job_id=job_id)


async def get_corpus_analyze_job(job_id: str) -> CorpusJob | None:
    return await get_corpus_job(job_id)


# Back-compat alias
CorpusAnalyzeJob = CorpusJob
