"""Lane-based subprocess concurrency — W9-S1 / Top-20 #15 back-pressure."""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import threading
import time
from collections.abc import AsyncIterator, Iterator, Sequence
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_LANE_MAX: dict[str, int] = {
    "ffmpeg": 4,
    "docker": 1,
    "soffice": 1,
    "fontconfig": 2,
}


class SubprocessPoolBusy(Exception):
    """Raised when a non-blocking lane acquire fails."""

    retry_after_seconds: int = 2


@dataclass
class _LaneState:
    max_concurrent: int
    semaphore: threading.BoundedSemaphore
    in_flight: int = 0
    waiting: int = 0
    total_started: int = 0
    total_rejected: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)


_lanes: dict[str, _LaneState] = {}
_lanes_lock = threading.Lock()


def pool_disabled() -> bool:
    return (os.environ.get("OAAO_SUBPROC_POOL_DISABLED") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _env_int(name: str, default: int, *, lo: int, hi: int) -> int:
    try:
        val = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        val = default
    return max(lo, min(hi, val))


def lane_max_concurrent(lane: str) -> int:
    key = (lane or "ffmpeg").strip().lower() or "ffmpeg"
    default = _DEFAULT_LANE_MAX.get(key, 2)
    env_name = f"OAAO_SUBPROC_MAX_{key.upper()}"
    return _env_int(env_name, default, lo=1, hi=32)


def _lane_state(lane: str) -> _LaneState:
    key = (lane or "ffmpeg").strip().lower() or "ffmpeg"
    with _lanes_lock:
        state = _lanes.get(key)
        if state is None:
            cap = lane_max_concurrent(key)
            state = _LaneState(max_concurrent=cap, semaphore=threading.BoundedSemaphore(cap))
            _lanes[key] = state
            logger.info("subprocess_pool lane=%s max_concurrent=%s", key, cap)
        return state


@contextmanager
def subprocess_slot_sync(*, lane: str = "ffmpeg", blocking: bool = True) -> Iterator[None]:
    if pool_disabled():
        yield
        return
    state = _lane_state(lane)
    acquired = False
    if not blocking:
        acquired = state.semaphore.acquire(blocking=False)
        if not acquired:
            with state.lock:
                state.total_rejected += 1
            raise SubprocessPoolBusy()
    else:
        with state.lock:
            state.waiting += 1
        try:
            state.semaphore.acquire()
            acquired = True
        finally:
            with state.lock:
                state.waiting = max(0, state.waiting - 1)
    with state.lock:
        state.in_flight += 1
        state.total_started += 1
    try:
        yield
    finally:
        with state.lock:
            state.in_flight = max(0, state.in_flight - 1)
        if acquired:
            state.semaphore.release()


@asynccontextmanager
async def subprocess_slot(*, lane: str = "ffmpeg", blocking: bool = True) -> AsyncIterator[None]:
    if pool_disabled():
        yield
        return
    state = _lane_state(lane)
    acquired = False
    if not blocking:
        acquired = await asyncio.to_thread(state.semaphore.acquire, False)
        if not acquired:
            with state.lock:
                state.total_rejected += 1
            raise SubprocessPoolBusy()
    else:
        with state.lock:
            state.waiting += 1
        try:
            await asyncio.to_thread(state.semaphore.acquire)
            acquired = True
        finally:
            with state.lock:
                state.waiting = max(0, state.waiting - 1)
    with state.lock:
        state.in_flight += 1
        state.total_started += 1
    try:
        yield
    finally:
        with state.lock:
            state.in_flight = max(0, state.in_flight - 1)
        if acquired:
            state.semaphore.release()


def run_sync(
    cmd: Sequence[str],
    *,
    lane: str = "docker",
    blocking: bool = True,
    **kwargs: Any,
) -> subprocess.CompletedProcess[str]:
    with subprocess_slot_sync(lane=lane, blocking=blocking):
        return subprocess.run(list(cmd), **kwargs)


async def run_exec(
    cmd: Sequence[str],
    *,
    lane: str = "ffmpeg",
    blocking: bool = True,
    **kwargs: Any,
) -> asyncio.subprocess.Process:
    async with subprocess_slot(lane=lane, blocking=blocking):
        return await asyncio.create_subprocess_exec(*cmd, **kwargs)


def subprocess_metrics_snapshot() -> dict[str, Any]:
    rows: dict[str, Any] = {}
    with _lanes_lock:
        items = list(_lanes.items())
    for key, state in items:
        with state.lock:
            rows[key] = {
                "max_concurrent": state.max_concurrent,
                "in_flight": state.in_flight,
                "waiting": state.waiting,
                "total_started": state.total_started,
                "total_rejected": state.total_rejected,
            }
    return {
        "disabled": pool_disabled(),
        "lanes": rows,
        "captured_at": time.time(),
    }
