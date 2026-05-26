"""W7-S2 / W8-S1 / W8-S2 — Queue backend boundary abstraction.

This module defines a single `QueueBackend` Protocol that the existing
`QueuePool` uses for all FIFO operations on `QueueJobPayload`s. Two
implementations are provided:

* `MemoryQueueBackend` — wraps `asyncio.Queue`, optionally bounded. Default
  for in-process post-stream pools; covers all existing call sites with zero
  behavioural change when `maxsize=0`.
* `RedisStreamQueueBackend` — canary backend (W8-S1) using a Redis stream
  per pool, with consumer-group semantics. Activated by setting
  `OAAO_QUEUE_BACKEND=redis` plus `OAAO_QUEUE_REDIS_URL`. If either env is
  unset, factory falls back to `MemoryQueueBackend` so behaviour is
  unchanged for non-canary tenants.

Backpressure (W8-S2):
- `OAAO_QUEUE_MAX_SIZE` (int, default `0` = unbounded) caps the in-memory
  queue. When full, `try_enqueue()` returns `False` and the caller is
  expected to either drop the job, retry, or surface backpressure to the
  upstream producer.
- `OAAO_QUEUE_GLOBAL_CONCURRENCY_CAP` (int, default `0` = unlimited) caps
  the total number of workers across *all* pools when set; pool sizes are
  scaled down proportionally on `start_post_stream_pools()`.

The Redis backend in this phase intentionally implements the minimum
surface (xadd / xreadgroup / xack) and is documented as **canary-only**
until W8-S3 adds metrics + a kill-switch.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from oaao_orchestrator.config_models import QueueJobPayload

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Backpressure / concurrency envelope
# --------------------------------------------------------------------------- #


def queue_max_size() -> int:
    """Per-pool maximum queue depth. 0 = unbounded (legacy behaviour)."""
    raw = os.environ.get("OAAO_QUEUE_MAX_SIZE", "").strip()
    if not raw:
        return 0
    try:
        value = int(raw)
    except ValueError:
        return 0
    return max(0, value)


def global_concurrency_cap() -> int:
    """Hard ceiling on the sum of worker_number across all pools. 0 = unlimited."""
    raw = os.environ.get("OAAO_QUEUE_GLOBAL_CONCURRENCY_CAP", "").strip()
    if not raw:
        return 0
    try:
        value = int(raw)
    except ValueError:
        return 0
    return max(0, value)


def apply_concurrency_cap(worker_counts: list[int]) -> list[int]:
    """Proportionally scale a list of `worker_number`s down to the global cap.

    Returns the input list verbatim if `OAAO_QUEUE_GLOBAL_CONCURRENCY_CAP` is
    unset or already satisfied. Each pool keeps at least 1 worker.
    """
    cap = global_concurrency_cap()
    if cap <= 0:
        return list(worker_counts)
    total = sum(worker_counts)
    if total <= cap:
        return list(worker_counts)
    scale = cap / total
    scaled = [max(1, int(n * scale)) for n in worker_counts]
    # Redistribute rounding remainder to preserve the cap exactly.
    delta = cap - sum(scaled)
    if delta > 0:
        # Hand extras to the largest pools first.
        order = sorted(range(len(scaled)), key=lambda i: worker_counts[i], reverse=True)
        i = 0
        while delta > 0 and order:
            scaled[order[i % len(order)]] += 1
            delta -= 1
            i += 1
    elif delta < 0:
        order = sorted(range(len(scaled)), key=lambda i: scaled[i], reverse=True)
        i = 0
        while delta < 0 and order:
            idx = order[i % len(order)]
            if scaled[idx] > 1:
                scaled[idx] -= 1
                delta += 1
            i += 1
    return scaled


# --------------------------------------------------------------------------- #
# Protocol
# --------------------------------------------------------------------------- #


class QueueBackend(Protocol):
    """Minimal FIFO surface every post-stream backend must satisfy."""

    async def put(self, job: QueueJobPayload) -> None: ...

    async def try_put(self, job: QueueJobPayload) -> bool: ...

    async def get(self, *, timeout: float) -> QueueJobPayload | None: ...

    def qsize(self) -> int: ...

    def closed(self) -> bool: ...

    async def close(self) -> None: ...


# --------------------------------------------------------------------------- #
# In-memory backend (default)
# --------------------------------------------------------------------------- #


class MemoryQueueBackend:
    """`asyncio.Queue`-backed backend; bounded when `OAAO_QUEUE_MAX_SIZE > 0`."""

    def __init__(self, *, maxsize: int | None = None) -> None:
        size = maxsize if maxsize is not None else queue_max_size()
        self._queue: asyncio.Queue[QueueJobPayload] = asyncio.Queue(maxsize=size)
        self._maxsize = size
        self._closed = False

    async def put(self, job: QueueJobPayload) -> None:
        await self._queue.put(job)

    async def try_put(self, job: QueueJobPayload) -> bool:
        try:
            self._queue.put_nowait(job)
            return True
        except asyncio.QueueFull:
            logger.warning(
                "queue_backend: memory queue full (maxsize=%s, depth=%s); dropping job plugin_id=%s",
                self._maxsize,
                self._queue.qsize(),
                getattr(job, "plugin_id", "?"),
            )
            return False

    async def get(self, *, timeout: float) -> QueueJobPayload | None:
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except TimeoutError:
            return None

    def qsize(self) -> int:
        return int(self._queue.qsize())

    def closed(self) -> bool:
        return self._closed

    async def close(self) -> None:
        self._closed = True


# --------------------------------------------------------------------------- #
# Redis stream backend (W8-S1 canary)
# --------------------------------------------------------------------------- #


class RedisStreamQueueBackend:
    """Redis-stream-backed backend with consumer-group semantics.

    **Canary status:** this implementation is intentionally minimal. It
    serialises `QueueJobPayload` via `model_dump_json()` and stores a single
    `"json"` field per stream entry. Failure modes (Redis down, group
    creation race) fall through to the wrapped exception so the caller can
    decide whether to switch back to the memory backend.
    """

    def __init__(
        self,
        *,
        url: str,
        stream_key: str,
        group: str,
        consumer: str,
        maxlen: int = 10_000,
    ) -> None:
        try:
            import redis.asyncio as redis_asyncio
        except ImportError as exc:  # pragma: no cover — optional dep
            raise RuntimeError(
                "redis backend selected but `redis` package not installed; "
                "either `pip install redis>=5` or unset OAAO_QUEUE_BACKEND"
            ) from exc
        self._redis = redis_asyncio.from_url(url, decode_responses=True)
        self._stream_key = stream_key
        self._group = group
        self._consumer = consumer
        self._maxlen = maxlen
        self._closed = False
        self._group_ready = False

    async def _ensure_group(self) -> None:
        if self._group_ready:
            return
        try:
            await self._redis.xgroup_create(
                name=self._stream_key,
                groupname=self._group,
                id="0",
                mkstream=True,
            )
        except Exception as exc:  # noqa: BLE001 — Redis BUSYGROUP is fine
            msg = str(exc)
            if "BUSYGROUP" not in msg:
                logger.warning("queue_backend: xgroup_create failed: %s", msg)
        self._group_ready = True

    async def put(self, job: QueueJobPayload) -> None:
        await self._ensure_group()
        payload = job.model_dump_json()
        await self._redis.xadd(
            self._stream_key,
            {"json": payload},
            maxlen=self._maxlen,
            approximate=True,
        )

    async def try_put(self, job: QueueJobPayload) -> bool:
        try:
            await self.put(job)
            return True
        except Exception:
            logger.exception("queue_backend: redis put failed")
            return False

    async def get(self, *, timeout: float) -> QueueJobPayload | None:
        await self._ensure_group()
        from oaao_orchestrator.config_models import QueueJobPayload as _Payload

        block_ms = max(1, int(timeout * 1000))
        result = await self._redis.xreadgroup(
            groupname=self._group,
            consumername=self._consumer,
            streams={self._stream_key: ">"},
            count=1,
            block=block_ms,
        )
        if not result:
            return None
        _, entries = result[0]
        if not entries:
            return None
        entry_id, fields = entries[0]
        try:
            payload_json = fields.get("json") if isinstance(fields, dict) else None
            if not payload_json:
                await self._redis.xack(self._stream_key, self._group, entry_id)
                return None
            job = _Payload.model_validate_json(payload_json)
        finally:
            await self._redis.xack(self._stream_key, self._group, entry_id)
        return job

    def qsize(self) -> int:
        # Redis xlen is async; expose 0 here to satisfy the Protocol cheaply.
        # Pools should treat redis qsize as advisory; metrics will land in W8-S3.
        return 0

    def closed(self) -> bool:
        return self._closed

    async def close(self) -> None:
        self._closed = True
        try:
            await self._redis.aclose()
        except Exception:  # noqa: BLE001 — best-effort
            logger.debug("queue_backend: redis aclose error", exc_info=True)


# --------------------------------------------------------------------------- #
# Factory
# --------------------------------------------------------------------------- #


def build_queue_backend(*, pool_id: str) -> QueueBackend:
    """Return the backend dictated by env. Always falls back to memory.

    - `OAAO_QUEUE_BACKEND=redis` + `OAAO_QUEUE_REDIS_URL` → Redis stream.
    - anything else → bounded `MemoryQueueBackend`.
    """
    backend = (os.environ.get("OAAO_QUEUE_BACKEND") or "").strip().lower()
    if backend == "redis":
        url = (os.environ.get("OAAO_QUEUE_REDIS_URL") or "").strip()
        if not url:
            logger.warning(
                "queue_backend: OAAO_QUEUE_BACKEND=redis but OAAO_QUEUE_REDIS_URL unset; "
                "falling back to memory backend for pool=%s",
                pool_id,
            )
            return MemoryQueueBackend()
        stream_key = (
            os.environ.get("OAAO_QUEUE_REDIS_STREAM_PREFIX") or "oaao:queue:"
        ) + pool_id
        group = os.environ.get("OAAO_QUEUE_REDIS_GROUP") or "oaao-orchestrator"
        consumer = (
            os.environ.get("OAAO_QUEUE_REDIS_CONSUMER")
            or f"{pool_id}-{os.getpid()}"
        )
        try:
            backend_obj: QueueBackend = RedisStreamQueueBackend(
                url=url, stream_key=stream_key, group=group, consumer=consumer
            )
        except RuntimeError as exc:
            logger.warning(
                "queue_backend: redis init failed for pool=%s (%s); using memory backend",
                pool_id,
                exc,
            )
            return MemoryQueueBackend()
        logger.info(
            "queue_backend: redis canary enabled pool=%s stream=%s",
            pool_id,
            stream_key,
        )
        return backend_obj
    return MemoryQueueBackend()
