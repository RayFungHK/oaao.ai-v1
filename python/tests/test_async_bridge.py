import asyncio

import pytest
from oaao_orchestrator.slide_project.async_bridge import _get_soffice_mutex, run_soffice_job


@pytest.mark.asyncio
async def test_soffice_mutex_is_async_context_manager() -> None:
    lock = _get_soffice_mutex()
    async with lock:
        assert lock.locked()
    assert not lock.locked()


@pytest.mark.asyncio
async def test_run_soffice_job_serializes() -> None:
    seen: list[int] = []

    def job(n: int) -> int:
        seen.append(n)
        return n

    a, b = await asyncio.gather(
        run_soffice_job(job, 1),
        run_soffice_job(job, 2),
    )
    assert {a, b} == {1, 2}
    assert len(seen) == 2
