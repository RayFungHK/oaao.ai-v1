from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from oaao_orchestrator.config_models import QueueJobPayload, QueuePoolSettings
from oaao_orchestrator.plugins.registry import default_plugin_factories
from oaao_orchestrator.plugins.spec import PluginContext

logger = logging.getLogger(__name__)


def load_pool_settings(path: Path) -> list[QueuePoolSettings]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("queue pool config must be a JSON array")
    return [QueuePoolSettings.model_validate(row) for row in raw]


class QueuePool:
    """In-process asyncio queue — swap for Redis stream / RQ without changing Pipeline hooks."""

    def __init__(self, settings: QueuePoolSettings) -> None:
        self.settings = settings
        self._queue: asyncio.Queue[QueueJobPayload] = asyncio.Queue()
        self._workers: list[asyncio.Task[Any]] = []
        self._stopped = asyncio.Event()

    async def enqueue(self, job: QueueJobPayload) -> None:
        await self._queue.put(job)

    async def start(self) -> None:
        n = int(self.settings.worker_number)
        self._workers = [asyncio.create_task(self._worker_loop(wid)) for wid in range(n)]

    async def stop(self) -> None:
        self._stopped.set()
        for t in self._workers:
            t.cancel()
        self._workers.clear()

    async def _worker_loop(self, worker_id: int) -> None:
        factories = default_plugin_factories()
        interval = float(self.settings.poll_interval_seconds)
        while not self._stopped.is_set():
            try:
                job = await asyncio.wait_for(self._queue.get(), timeout=interval)
            except asyncio.TimeoutError:
                continue
            handler = factories.get(job.plugin_id)
            if handler is None:
                logger.warning("unknown plugin_id=%s pool=%s worker=%s", job.plugin_id, self.settings.pool_id, worker_id)
                continue
            plugin = handler()
            prompt = self._render_prompt_stub(job)
            ctx = PluginContext(
                pool_id=self.settings.pool_id,
                purpose_id=self.settings.purpose_id,
                mode_id=self.settings.mode_id,
                meta=job.plugin_ctx_meta,
            )
            try:
                await plugin.run(ctx, prompt_rendered=prompt, endpoint_snapshot=job.endpoint.model_dump())
            except Exception:
                logger.exception("plugin %s failed pool=%s worker=%s", job.plugin_id, self.settings.pool_id, worker_id)

    def _render_prompt_stub(self, job: QueueJobPayload) -> str:
        """Replace with MD loader + purpose interpolation."""
        ref = job.prompt_material_ref or self.settings.prompt_bundle_ref
        return f"[stub prompt ref={ref}]"


async def spawn_post_stream_jobs(
    *,
    pool: QueuePool,
    plugin_ctx_meta: dict[str, Any],
    per_job_prompt_ref: str | None = None,
) -> None:
    """Called from Pipeline ``after_stream`` — never blocks LLM stream."""
    ep = pool.settings.endpoint
    for pid in pool.settings.plugins_after_stream:
        payload = QueueJobPayload(
            plugin_id=pid,
            prompt_material_ref=per_job_prompt_ref or pool.settings.prompt_bundle_ref,
            endpoint=ep,
            plugin_ctx_meta=plugin_ctx_meta,
        )
        await pool.enqueue(payload)
