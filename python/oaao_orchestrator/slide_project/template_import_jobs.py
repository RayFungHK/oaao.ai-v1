"""In-memory background jobs for long-running PPTX template imports."""

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
class TemplateImportJob:
    job_id: str
    status: str  # running | done | failed
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)


_jobs: dict[str, TemplateImportJob] = {}
_jobs_lock = asyncio.Lock()


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


async def start_template_import_job(
    runner: Callable[[], Awaitable[dict[str, Any]]],
) -> str:
    job_id = f"tij-{uuid.uuid4().hex[:12]}"
    job = TemplateImportJob(job_id=job_id, status="running")
    async with _jobs_lock:
        _prune_jobs_locked()
        _jobs[job_id] = job

    async def _run() -> None:
        try:
            payload = await runner()
            async with _jobs_lock:
                stored = _jobs.get(job_id)
                if stored is None:
                    return
                stored.status = "done"
                stored.result = payload
        except Exception as exc:  # noqa: BLE001
            async with _jobs_lock:
                stored = _jobs.get(job_id)
                if stored is None:
                    return
                stored.status = "failed"
                stored.error = str(exc) or exc.__class__.__name__

    asyncio.create_task(_run())  # noqa: RUF006
    return job_id


async def get_template_import_job(job_id: str) -> TemplateImportJob | None:
    async with _jobs_lock:
        return _jobs.get(job_id.strip())
