"""Rate-limit outbound research article fetches (avoid arXiv / publisher IP blocks)."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int, *, lo: int, hi: int) -> int:
    try:
        val = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        val = default
    return max(lo, min(hi, val))


def _env_float(name: str, default: float, *, lo: float, hi: float) -> float:
    try:
        val = float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        val = default
    return max(lo, min(hi, val))


def research_fetch_max_concurrent() -> int:
    return _env_int("OAAO_RESEARCH_FETCH_MAX_CONCURRENT", 4, lo=1, hi=5)


def research_fetch_min_interval_sec() -> float:
    return _env_float("OAAO_RESEARCH_FETCH_MIN_INTERVAL_SEC", 2.5, lo=0.5, hi=30.0)


def research_fetch_post_cooldown_sec() -> float:
    return _env_float("OAAO_RESEARCH_FETCH_POST_COOLDOWN_SEC", 0.5, lo=0.0, hi=10.0)


_sem: asyncio.Semaphore | None = None
_interval_lock_inst: asyncio.Lock | None = None
_last_fetch_started_at: float = 0.0


def _semaphore() -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        n = research_fetch_max_concurrent()
        _sem = asyncio.Semaphore(n)
        logger.info(
            "research fetch throttle: max_concurrent=%s min_interval=%.1fs post_cooldown=%.1fs",
            n,
            research_fetch_min_interval_sec(),
            research_fetch_post_cooldown_sec(),
        )
    return _sem


def _interval_lock() -> asyncio.Lock:
    global _interval_lock_inst
    if _interval_lock_inst is None:
        _interval_lock_inst = asyncio.Lock()
    return _interval_lock_inst


@asynccontextmanager
async def research_fetch_slot() -> AsyncIterator[None]:
    """Hold while performing HTTP fetch for one article (global cap + min spacing)."""
    global _last_fetch_started_at

    sem = _semaphore()
    await sem.acquire()
    try:
        async with _interval_lock():
            now = time.monotonic()
            wait = research_fetch_min_interval_sec() - (now - _last_fetch_started_at)
            if wait > 0:
                await asyncio.sleep(wait)
            _last_fetch_started_at = time.monotonic()
        yield
    finally:
        cooldown = research_fetch_post_cooldown_sec()
        if cooldown > 0:
            await asyncio.sleep(cooldown)
        sem.release()
