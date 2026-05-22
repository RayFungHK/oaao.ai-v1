"""Run CPU/IO-heavy slide work off the asyncio event loop."""

from __future__ import annotations

import asyncio
import functools
from collections.abc import Callable
from typing import Any, TypeVar

T = TypeVar("T")

# LibreOffice headless is not safe to run concurrently in one container.
_soffice_mutex: asyncio.Lock | None = None


def _get_soffice_mutex() -> asyncio.Lock:
    global _soffice_mutex
    if _soffice_mutex is None:
        _soffice_mutex = asyncio.Lock()
    return _soffice_mutex


async def run_blocking(
    fn: Callable[..., T],
    /,
    *args: Any,
    **kwargs: Any,
) -> T:
    """Execute a blocking callable in the default thread pool."""
    bound = functools.partial(fn, *args, **kwargs)
    return await asyncio.to_thread(bound)


async def run_soffice_job(
    fn: Callable[..., T],
    /,
    *args: Any,
    **kwargs: Any,
) -> T:
    """Serialize LibreOffice render jobs — avoids hung multi-soffice imports."""
    async with _get_soffice_mutex():
        return await run_blocking(fn, *args, **kwargs)
