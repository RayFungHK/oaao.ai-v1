from oaao_orchestrator.research.worker import (
    _inline_run_job_limit,
    _refetch_jobs_from_payload,
)


def test_refetch_jobs_from_payload() -> None:
    payload = {
        "refetch_items": [
            {
                "canonical_url": "https://arxiv.org/abs/2605.23610",
                "title": "Paper A",
                "source_id": 3,
            },
            {"canonical_url": "https://arxiv.org/abs/2605.11111", "title": "", "source_id": None},
            {"canonical_url": "  ", "title": "skip"},
        ],
    }
    jobs = _refetch_jobs_from_payload(payload)
    assert len(jobs) == 2
    assert jobs[0]["canonical_url"] == "https://arxiv.org/abs/2605.23610"
    assert jobs[0]["title"] == "Paper A"
    assert jobs[0]["source_id"] == 3
    assert jobs[0]["sort_order"] == 0
    assert jobs[1]["title"] is None


def test_inline_run_job_limit_refetch_stays_bounded() -> None:
    assert _inline_run_job_limit(20, {}, force_refetch=False) == 20
    assert _inline_run_job_limit(20, {}, force_refetch=True) == 20
    assert _inline_run_job_limit(20, {"refetch_inline_max": 8}, force_refetch=True) == 8
    assert _inline_run_job_limit(99, {"run_inline_max": 12}, force_refetch=False) == 12
