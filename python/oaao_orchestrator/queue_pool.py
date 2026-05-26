from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from oaao_orchestrator.config_models import EndpointSnapshot, QueueJobPayload, QueuePoolSettings
from oaao_orchestrator.plugins.registry import default_plugin_factories
from oaao_orchestrator.plugins.spec import PluginContext
from oaao_orchestrator.post_stream_llm import uiqe_endpoint_ready
from oaao_orchestrator.post_stream_prompt import (
    build_prompt_variables,
    prompt_ref_for_plugin,
    render_worker_prompt,
    resolve_prompt_path,
)
from oaao_orchestrator.queue_backend import QueueBackend, build_queue_backend

logger = logging.getLogger(__name__)


def load_pool_settings(path: Path) -> list[QueuePoolSettings]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("queue pool config must be a JSON array")
    return [QueuePoolSettings.model_validate(row) for row in raw]


class QueuePool:
    """In-process asyncio queue — swap for Redis stream / RQ without changing Pipeline hooks.

    W7-S2: FIFO operations now flow through a `QueueBackend` Protocol so the
    storage substrate (memory / Redis stream) is selected by env at
    construction time. Pipeline + plugin code is unchanged.
    """

    def __init__(
        self,
        settings: QueuePoolSettings,
        *,
        backend: QueueBackend | None = None,
    ) -> None:
        self.settings = settings
        self._backend: QueueBackend = backend or build_queue_backend(pool_id=settings.pool_id)
        self._workers: list[asyncio.Task[Any]] = []
        self._stopped = asyncio.Event()

    async def enqueue(self, job: QueueJobPayload) -> None:
        await self._backend.put(job)

    async def try_enqueue(self, job: QueueJobPayload) -> bool:
        """Non-blocking enqueue — returns False under backpressure (W8-S2)."""
        return await self._backend.try_put(job)

    def queue_depth(self) -> int:
        return self._backend.qsize()

    def worker_count(self) -> int:
        return len(self._workers)

    async def start(self) -> None:
        n = int(self.settings.worker_number)
        self._workers = [asyncio.create_task(self._worker_loop(wid)) for wid in range(n)]

    async def stop(self) -> None:
        self._stopped.set()
        for t in self._workers:
            t.cancel()
        self._workers.clear()
        await self._backend.close()

    async def _worker_loop(self, worker_id: int) -> None:
        factories = default_plugin_factories()
        interval = float(self.settings.poll_interval_seconds)
        while not self._stopped.is_set():
            job = await self._backend.get(timeout=interval)
            if job is None:
                continue
            handler = factories.get(job.plugin_id)
            if handler is None:
                logger.warning(
                    "unknown plugin_id=%s pool=%s worker=%s",
                    job.plugin_id,
                    self.settings.pool_id,
                    worker_id,
                )
                continue
            plugin = handler()
            prompt = self.render_prompt(job)
            meta = job.plugin_ctx_meta if isinstance(job.plugin_ctx_meta, dict) else {}
            ctx = PluginContext(
                pool_id=self.settings.pool_id,
                purpose_id=self.settings.purpose_id,
                mode_id=self.settings.mode_id,
                conversation_id=str(meta.get("conversation_id") or "") or None,
                message_id=str(meta.get("assistant_message_id") or "") or None,
                user_id=str(meta.get("user_id") or "") or None,
                meta=meta,
            )
            try:
                await plugin.run(
                    ctx, prompt_rendered=prompt, endpoint_snapshot=job.endpoint.model_dump()
                )
            except Exception:
                logger.exception(
                    "plugin %s failed pool=%s worker=%s",
                    job.plugin_id,
                    self.settings.pool_id,
                    worker_id,
                )

    def render_prompt(self, job: QueueJobPayload) -> str:
        ref = job.prompt_material_ref or prompt_ref_for_plugin(
            job.plugin_id, bundle_ref=self.settings.prompt_bundle_ref
        )
        path = resolve_prompt_path(ref)
        if path is None:
            return f"[missing prompt ref={ref}]"
        variables = build_prompt_variables(
            job.plugin_ctx_meta if isinstance(job.plugin_ctx_meta, dict) else {}
        )
        return render_worker_prompt(path, variables)


async def spawn_post_stream_jobs(
    *,
    pool: QueuePool,
    plugin_ctx_meta: dict[str, Any],
    uiqe_endpoint: EndpointSnapshot | dict[str, Any] | None = None,
) -> None:
    """Called from Pipeline ``after_stream`` — never blocks LLM stream."""
    if isinstance(uiqe_endpoint, EndpointSnapshot):
        ep = uiqe_endpoint
    elif isinstance(uiqe_endpoint, dict):
        ep = EndpointSnapshot.model_validate(uiqe_endpoint)
    else:
        ep = pool.settings.endpoint

    ep_dump = ep.model_dump()
    if not uiqe_endpoint_ready(ep_dump):
        logger.warning(
            "post_stream jobs skipped — uiqe endpoint unresolved pool=%s conversation_id=%s",
            pool.settings.pool_id,
            plugin_ctx_meta.get("conversation_id"),
        )
        return

    for pid in pool.settings.plugins_after_stream:
        ref = prompt_ref_for_plugin(pid, bundle_ref=pool.settings.prompt_bundle_ref)
        payload = QueueJobPayload(
            plugin_id=pid,
            prompt_material_ref=ref,
            endpoint=ep,
            plugin_ctx_meta=plugin_ctx_meta,
        )
        await pool.enqueue(payload)
