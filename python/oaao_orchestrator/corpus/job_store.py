"""File-backed corpus job persistence (survives orchestrator restart within TTL)."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from oaao_orchestrator.corpus.jobs import CorpusJob

_JOB_TTL_SEC = 3600


def job_store_dir() -> Path:
    raw = (os.environ.get("OAAO_CORPUS_JOB_STORE_DIR") or "").strip()
    if raw:
        return Path(raw)
    return Path("/var/www/html/storage/orchestrator-corpus-jobs")


def _job_path(job_id: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in job_id.strip())
    return job_store_dir() / f"{safe}.json"


def persist_job(job: CorpusJob) -> None:
    try:
        root = job_store_dir()
        root.mkdir(parents=True, exist_ok=True)
        payload = {
            "job_id": job.job_id,
            "status": job.status,
            "error": job.error,
            "created_at": job.created_at,
            "result": job.result,
        }
        _job_path(job.job_id).write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass


def load_job(job_id: str) -> CorpusJob | None:
    path = _job_path(job_id)
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    created = float(raw.get("created_at") or 0)
    if created and time.time() - created > _JOB_TTL_SEC:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return None
    return CorpusJob(
        job_id=str(raw.get("job_id") or job_id),
        status=str(raw.get("status") or "failed"),
        result=raw.get("result") if isinstance(raw.get("result"), dict) else None,
        error=str(raw["error"]) if raw.get("error") else None,
        created_at=created or time.time(),
    )


def prune_job_store() -> None:
    root = job_store_dir()
    if not root.is_dir():
        return
    now = time.time()
    for path in root.glob("*.json"):
        try:
            if now - path.stat().st_mtime > _JOB_TTL_SEC:
                path.unlink(missing_ok=True)
        except OSError:
            continue
