from __future__ import annotations

import json
from pathlib import Path

import pytest

from oaao_orchestrator.config_models import EndpointSnapshot, QueuePoolSettings
from oaao_orchestrator.post_stream_pool import build_post_stream_plugin_ctx_meta
from oaao_orchestrator.queue_pool import QueuePool, load_pool_settings, spawn_post_stream_jobs

_UIQE_EP = EndpointSnapshot(
    endpoint_ref="uiqe.primary",
    base_url="http://mock-llm",
    model="mock-uiqe",
    api_key_env=None,
)


class _Req:
    conversation_id = "42"
    assistant_message_id = "99"
    user_id = "7"
    tenant_id = 1
    purpose_id = "chat"
    mode_id = "default"
    workspace_id = 3


@pytest.mark.asyncio
async def test_spawn_post_stream_jobs_enqueues_iqs_and_accs(tmp_path: Path) -> None:
    cfg = tmp_path / "pools.json"
    cfg.write_text(
        json.dumps(
            [
                {
                    "pool_id": "post_stream_metrics",
                    "worker_number": 1,
                    "poll_interval_seconds": 0.05,
                    "plugins_after_stream": ["iqs", "accs"],
                }
            ]
        ),
        encoding="utf-8",
    )
    settings = load_pool_settings(cfg)
    pool = QueuePool(settings[0])
    await pool.start()
    try:
        meta = build_post_stream_plugin_ctx_meta(_Req(), {"materials": [{}], "tasks": {"items": []}})
        await spawn_post_stream_jobs(pool=pool, plugin_ctx_meta=meta, uiqe_endpoint=_UIQE_EP)
        assert pool._queue.qsize() == 2
        j1 = pool._queue.get_nowait()
        j2 = pool._queue.get_nowait()
        assert {j1.plugin_id, j2.plugin_id} == {"iqs", "accs"}
        assert j1.plugin_ctx_meta["conversation_id"] == "42"
        assert j1.endpoint.model == "mock-uiqe"
        assert j1.prompt_material_ref.endswith("iqs.md")
        assert j2.prompt_material_ref.endswith("accs.md")
    finally:
        await pool.stop()


@pytest.mark.asyncio
async def test_spawn_skips_without_uiqe_endpoint(tmp_path: Path) -> None:
    cfg = tmp_path / "pools.json"
    cfg.write_text(
        json.dumps([{"pool_id": "p", "worker_number": 1, "plugins_after_stream": ["iqs"]}]),
        encoding="utf-8",
    )
    pool = QueuePool(load_pool_settings(cfg)[0])
    meta = build_post_stream_plugin_ctx_meta(_Req(), None)
    await spawn_post_stream_jobs(pool=pool, plugin_ctx_meta=meta, uiqe_endpoint=None)
    assert pool._queue.qsize() == 0


def test_build_post_stream_plugin_ctx_meta() -> None:
    meta = build_post_stream_plugin_ctx_meta(_Req(), {"materials": [{}, {}]})
    assert meta["assistant_message_id"] == "99"
    assert meta["materials_count"] == 2
    assert meta["tenant_id"] == 1
