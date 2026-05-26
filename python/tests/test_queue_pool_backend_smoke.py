"""W6-S2 / W7-S2 — QueuePool ↔ MemoryQueueBackend smoke."""

from __future__ import annotations

import asyncio

from oaao_orchestrator.config_models import EndpointSnapshot, QueueJobPayload, QueuePoolSettings
from oaao_orchestrator.queue_backend import MemoryQueueBackend
from oaao_orchestrator.queue_pool import QueuePool


def _settings() -> QueuePoolSettings:
    return QueuePoolSettings(
        pool_id="test_pool",
        worker_number=1,
        poll_interval_seconds=0.05,
        purpose_id="t",
        mode_id="m",
        prompt_bundle_ref="",
        endpoint=EndpointSnapshot(),
        plugins_after_stream=[],
    )


def test_queue_pool_delegates_to_injected_backend():
    async def _run():
        backend = MemoryQueueBackend(maxsize=0)
        pool = QueuePool(_settings(), backend=backend)
        await pool.enqueue(QueueJobPayload(plugin_id="iqs"))
        assert pool.queue_depth() == 1
        ok = await pool.try_enqueue(QueueJobPayload(plugin_id="accs"))
        assert ok is True
        assert pool.queue_depth() == 2

    asyncio.run(_run())


def test_queue_pool_try_enqueue_returns_false_on_full():
    async def _run():
        backend = MemoryQueueBackend(maxsize=1)
        pool = QueuePool(_settings(), backend=backend)
        assert await pool.try_enqueue(QueueJobPayload(plugin_id="iqs")) is True
        assert await pool.try_enqueue(QueueJobPayload(plugin_id="accs")) is False
        assert pool.queue_depth() == 1

    asyncio.run(_run())


def test_queue_pool_stop_closes_backend():
    async def _run():
        backend = MemoryQueueBackend(maxsize=0)
        pool = QueuePool(_settings(), backend=backend)
        await pool.start()
        await pool.stop()
        assert backend.closed() is True
        assert pool.worker_count() == 0

    asyncio.run(_run())
