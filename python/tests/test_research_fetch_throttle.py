import asyncio
import time

import pytest

from oaao_orchestrator.research import fetch_throttle as ft


@pytest.mark.asyncio
async def test_research_fetch_slot_enforces_min_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OAAO_RESEARCH_FETCH_MAX_CONCURRENT", "2")
    monkeypatch.setenv("OAAO_RESEARCH_FETCH_MIN_INTERVAL_SEC", "0.2")
    monkeypatch.setenv("OAAO_RESEARCH_FETCH_POST_COOLDOWN_SEC", "0")
    ft._sem = None
    ft._interval_lock_inst = None
    ft._last_fetch_started_at = 0.0

    times: list[float] = []

    async def one() -> None:
        async with ft.research_fetch_slot():
            times.append(time.monotonic())

    await asyncio.gather(one(), one())
    assert len(times) == 2
    assert times[1] - times[0] >= 0.18


def test_research_fetch_max_concurrent_clamped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OAAO_RESEARCH_FETCH_MAX_CONCURRENT", "99")
    ft._sem = None
    assert ft.research_fetch_max_concurrent() == 5
    monkeypatch.setenv("OAAO_RESEARCH_FETCH_MAX_CONCURRENT", "0")
    ft._sem = None
    assert ft.research_fetch_max_concurrent() == 1
