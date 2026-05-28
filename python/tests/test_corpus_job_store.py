"""Corpus job file persistence."""

from __future__ import annotations

import time

from oaao_orchestrator.corpus.job_store import job_store_dir, load_job, persist_job
from oaao_orchestrator.corpus.jobs import CorpusJob


def test_job_store_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("OAAO_CORPUS_JOB_STORE_DIR", str(tmp_path))
    job = CorpusJob(
        job_id="crn-test123",
        status="done",
        result={"ok": True, "format": "html", "html": "<html></html>"},
        created_at=time.time(),
    )
    persist_job(job)
    loaded = load_job("crn-test123")
    assert loaded is not None
    assert loaded.status == "done"
    assert loaded.result and loaded.result.get("format") == "html"
    assert job_store_dir() == tmp_path
