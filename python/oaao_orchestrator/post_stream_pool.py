"""Post-stream QueuePool lifecycle — IQS / ACCS after chat ``system/end``."""

from __future__ import annotations

import asyncio
import logging
import os
import signal
from pathlib import Path
from typing import Any

from oaao_orchestrator.config_models import EndpointSnapshot
from oaao_orchestrator.queue_backend import apply_concurrency_cap
from oaao_orchestrator.queue_metrics import effective_queue_backend_name
from oaao_orchestrator.queue_pool import QueuePool, load_pool_settings, spawn_post_stream_jobs

logger = logging.getLogger(__name__)

_pools: list[QueuePool] = []
_reload_requested = False
_reload_watcher: asyncio.Task[Any] | None = None
_sighup_installed = False


def request_post_stream_reload() -> None:
    """W8-S3 — SIGHUP / admin hook to rebuild pools with fresh env."""
    global _reload_requested
    _reload_requested = True
    logger.info(
        "post_stream reload requested (backend=%s kill_switch=%s)",
        effective_queue_backend_name(),
        os.environ.get("OAAO_QUEUE_KILL_SWITCH", ""),
    )


def _install_sighup_reload_handler() -> None:
    global _sighup_installed
    if _sighup_installed:
        return
    try:
        signal.signal(signal.SIGHUP, lambda *_: request_post_stream_reload())
        _sighup_installed = True
        logger.info("post_stream SIGHUP reload handler installed")
    except (ValueError, OSError):
        logger.debug("post_stream SIGHUP handler unavailable on this platform")


async def _reload_watcher_loop() -> None:
    global _reload_requested
    while True:
        await asyncio.sleep(1.0)
        if not _reload_requested:
            continue
        _reload_requested = False
        logger.info("post_stream reloading pools")
        await stop_post_stream_pools()
        await start_post_stream_pools(skip_watcher=True)


async def start_post_stream_pools(*, skip_watcher: bool = False) -> None:
    global _pools, _reload_watcher
    _install_sighup_reload_handler()
    raw = os.environ.get("OAAO_QUEUE_POOLS_JSON", "").strip()
    if not raw:
        logger.info("post_stream pools disabled (OAAO_QUEUE_POOLS_JSON unset)")
        return
    path = Path(raw)
    if not path.is_file():
        logger.warning("post_stream pool config missing: %s", path)
        return
    try:
        settings_list = load_pool_settings(path)
    except Exception:
        logger.exception("post_stream pool config invalid path=%s", path)
        return
    # W8-S2 — proportionally scale worker_number down if a global cap is set.
    original = [int(row.worker_number) for row in settings_list]
    capped = apply_concurrency_cap(original)
    if capped != original:
        logger.info(
            "post_stream pools: applying global concurrency cap %s -> %s",
            original,
            capped,
        )
        for row, n in zip(settings_list, capped, strict=True):
            row.worker_number = n  # type: ignore[assignment]
    _pools = [QueuePool(row) for row in settings_list]
    for pool in _pools:
        await pool.start()
    logger.info(
        "post_stream pools started count=%s ids=%s backend=%s",
        len(_pools),
        [p.settings.pool_id for p in _pools],
        effective_queue_backend_name(),
    )
    if not skip_watcher and _reload_watcher is None:
        _reload_watcher = asyncio.create_task(_reload_watcher_loop())  # noqa: RUF006


async def stop_post_stream_pools() -> None:
    for pool in _pools:
        await pool.stop()
    _pools.clear()


def post_stream_pools() -> list[QueuePool]:
    return list(_pools)


def uiqe_endpoint_from_request(req: Any) -> EndpointSnapshot | None:
    raw = getattr(req, "uiqe", None)
    if not isinstance(raw, dict):
        return None
    base = str(raw.get("base_url") or "").strip()
    model = str(raw.get("model") or "").strip()
    if not base or not model:
        return None
    return EndpointSnapshot(
        endpoint_ref=str(raw.get("purpose_key") or "uiqe"),
        base_url=base,
        model=model,
        api_key_env=raw.get("api_key_env") if isinstance(raw.get("api_key_env"), str) else None,
    )


def build_post_stream_plugin_ctx_meta(
    req: Any, metrics_payload: dict[str, Any] | None
) -> dict[str, Any]:
    """Stable meta for ``iqs`` / ``accs`` workers — no full transcripts."""
    meta: dict[str, Any] = {
        "conversation_id": str(getattr(req, "conversation_id", None) or ""),
        "assistant_message_id": str(getattr(req, "assistant_message_id", None) or ""),
        "user_id": str(getattr(req, "user_id", None) or ""),
        "purpose_id": str(getattr(req, "purpose_id", None) or "chat"),
        "mode_id": str(getattr(req, "mode_id", None) or "default"),
    }
    tid = getattr(req, "tenant_id", None)
    if tid is not None:
        try:
            meta["tenant_id"] = int(tid)
        except (TypeError, ValueError):
            pass
    wid = getattr(req, "workspace_id", None)
    if wid is not None:
        try:
            meta["workspace_id"] = int(wid)
        except (TypeError, ValueError):
            pass
    if isinstance(metrics_payload, dict):
        mats = metrics_payload.get("materials")
        if isinstance(mats, list):
            meta["materials_count"] = len(mats)
        tasks = metrics_payload.get("tasks")
        if isinstance(tasks, dict):
            items = tasks.get("items")
            if isinstance(items, list):
                meta["task_count"] = len(items)
    return meta


async def enqueue_post_stream_jobs_for_chat(
    *,
    req: Any,
    metrics_payload: dict[str, Any] | None,
) -> None:
    pools = post_stream_pools()
    if not pools:
        return
    plugin_ctx_meta = build_post_stream_plugin_ctx_meta(req, metrics_payload)
    uiqe_ep = uiqe_endpoint_from_request(req)
    for pool in pools:
        if not pool.settings.plugins_after_stream:
            continue
        await spawn_post_stream_jobs(
            pool=pool,
            plugin_ctx_meta=plugin_ctx_meta,
            uiqe_endpoint=uiqe_ep,
        )
        logger.info(
            "post_stream_jobs enqueued pool=%s plugins=%s conversation_id=%s assistant_message_id=%s",
            pool.settings.pool_id,
            pool.settings.plugins_after_stream,
            plugin_ctx_meta.get("conversation_id"),
            plugin_ctx_meta.get("assistant_message_id"),
        )
