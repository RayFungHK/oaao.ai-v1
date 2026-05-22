"""Post-stream QueuePool lifecycle — IQS / ACCS after chat ``system/end``."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from oaao_orchestrator.queue_pool import QueuePool, load_pool_settings, spawn_post_stream_jobs

logger = logging.getLogger(__name__)

_pools: list[QueuePool] = []


async def start_post_stream_pools() -> None:
    global _pools
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
    _pools = [QueuePool(row) for row in settings_list]
    for pool in _pools:
        await pool.start()
    logger.info(
        "post_stream pools started count=%s ids=%s",
        len(_pools),
        [p.settings.pool_id for p in _pools],
    )


async def stop_post_stream_pools() -> None:
    for pool in _pools:
        await pool.stop()
    _pools.clear()


def post_stream_pools() -> list[QueuePool]:
    return list(_pools)


def build_post_stream_plugin_ctx_meta(req: Any, metrics_payload: dict[str, Any] | None) -> dict[str, Any]:
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
    for pool in pools:
        if not pool.settings.plugins_after_stream:
            continue
        await spawn_post_stream_jobs(pool=pool, plugin_ctx_meta=plugin_ctx_meta)
        logger.info(
            "post_stream_jobs enqueued pool=%s plugins=%s conversation_id=%s assistant_message_id=%s",
            pool.settings.pool_id,
            pool.settings.plugins_after_stream,
            plugin_ctx_meta.get("conversation_id"),
            plugin_ctx_meta.get("assistant_message_id"),
        )
