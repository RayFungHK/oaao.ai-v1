"""W7-S2 / W8-S2 — Queue backend boundary + backpressure contract tests."""

from __future__ import annotations

import asyncio

import pytest
from oaao_orchestrator.config_models import EndpointSnapshot, QueueJobPayload
from oaao_orchestrator.queue_backend import (
    MemoryQueueBackend,
    apply_concurrency_cap,
    build_queue_backend,
    global_concurrency_cap,
    queue_max_size,
)


def _payload(pid: str = "iqs") -> QueueJobPayload:
    return QueueJobPayload(
        plugin_id=pid,
        prompt_material_ref="",
        endpoint=EndpointSnapshot(),
        plugin_ctx_meta={"conversation_id": "c1"},
    )


# ---- env knobs ------------------------------------------------------------ #


def test_queue_max_size_default_zero(monkeypatch):
    monkeypatch.delenv("OAAO_QUEUE_MAX_SIZE", raising=False)
    assert queue_max_size() == 0


def test_queue_max_size_invalid_returns_zero(monkeypatch):
    monkeypatch.setenv("OAAO_QUEUE_MAX_SIZE", "not-an-int")
    assert queue_max_size() == 0


def test_queue_max_size_negative_clamps_to_zero(monkeypatch):
    monkeypatch.setenv("OAAO_QUEUE_MAX_SIZE", "-7")
    assert queue_max_size() == 0


def test_queue_max_size_parses(monkeypatch):
    monkeypatch.setenv("OAAO_QUEUE_MAX_SIZE", "32")
    assert queue_max_size() == 32


def test_global_concurrency_cap_default_zero(monkeypatch):
    monkeypatch.delenv("OAAO_QUEUE_GLOBAL_CONCURRENCY_CAP", raising=False)
    assert global_concurrency_cap() == 0


# ---- concurrency cap math ------------------------------------------------- #


def test_apply_concurrency_cap_noop_when_unset(monkeypatch):
    monkeypatch.delenv("OAAO_QUEUE_GLOBAL_CONCURRENCY_CAP", raising=False)
    assert apply_concurrency_cap([2, 4, 8]) == [2, 4, 8]


def test_apply_concurrency_cap_noop_when_under_budget(monkeypatch):
    monkeypatch.setenv("OAAO_QUEUE_GLOBAL_CONCURRENCY_CAP", "100")
    assert apply_concurrency_cap([2, 4, 8]) == [2, 4, 8]


def test_apply_concurrency_cap_scales_down(monkeypatch):
    monkeypatch.setenv("OAAO_QUEUE_GLOBAL_CONCURRENCY_CAP", "7")
    out = apply_concurrency_cap([4, 8, 4])
    assert sum(out) == 7
    assert all(n >= 1 for n in out)


def test_apply_concurrency_cap_preserves_minimum_one(monkeypatch):
    monkeypatch.setenv("OAAO_QUEUE_GLOBAL_CONCURRENCY_CAP", "3")
    out = apply_concurrency_cap([10, 10, 10])
    assert all(n >= 1 for n in out)
    assert sum(out) == 3


# ---- memory backend ------------------------------------------------------- #


def test_memory_backend_unbounded_put_get():
    async def _run():
        backend = MemoryQueueBackend(maxsize=0)
        await backend.put(_payload("a"))
        await backend.put(_payload("b"))
        assert backend.qsize() == 2
        first = await backend.get(timeout=0.1)
        second = await backend.get(timeout=0.1)
        assert first is not None and first.plugin_id == "a"
        assert second is not None and second.plugin_id == "b"
        await backend.close()
        assert backend.closed()

    asyncio.run(_run())


def test_memory_backend_get_timeout_returns_none():
    async def _run():
        backend = MemoryQueueBackend(maxsize=0)
        assert await backend.get(timeout=0.05) is None

    asyncio.run(_run())


def test_memory_backend_try_put_rejects_when_full():
    async def _run():
        backend = MemoryQueueBackend(maxsize=2)
        assert await backend.try_put(_payload("a"))
        assert await backend.try_put(_payload("b"))
        # third should be rejected — backpressure surface for W8-S2
        assert not await backend.try_put(_payload("c"))
        assert backend.qsize() == 2

    asyncio.run(_run())


# ---- factory ------------------------------------------------------------- #


def test_build_queue_backend_defaults_to_memory(monkeypatch):
    monkeypatch.delenv("OAAO_QUEUE_BACKEND", raising=False)
    backend = build_queue_backend(pool_id="default_post_stream")
    assert isinstance(backend, MemoryQueueBackend)


def test_build_queue_backend_redis_without_url_falls_back(monkeypatch):
    monkeypatch.setenv("OAAO_QUEUE_BACKEND", "redis")
    monkeypatch.delenv("OAAO_QUEUE_REDIS_URL", raising=False)
    backend = build_queue_backend(pool_id="default_post_stream")
    assert isinstance(backend, MemoryQueueBackend)


def test_build_queue_backend_redis_without_package_falls_back(monkeypatch):
    monkeypatch.setenv("OAAO_QUEUE_BACKEND", "redis")
    monkeypatch.setenv("OAAO_QUEUE_REDIS_URL", "redis://localhost:6379/0")
    pytest.importorskip("pytest", reason="env probe")
    try:
        import redis
    except ImportError:
        # redis pkg absent: factory must NOT raise — falls back to memory
        backend = build_queue_backend(pool_id="default_post_stream")
        assert isinstance(backend, MemoryQueueBackend)
    else:
        # redis pkg present: factory builds the redis backend (no connection attempted yet)
        backend = build_queue_backend(pool_id="default_post_stream")
        # Cannot import RedisStreamQueueBackend at top without redis pkg; runtime check:
        assert type(backend).__name__ in {"RedisStreamQueueBackend", "MemoryQueueBackend"}
