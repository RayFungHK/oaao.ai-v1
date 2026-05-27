from __future__ import annotations

import asyncio

import pytest

from oaao_orchestrator.subprocess_pool import (
    SubprocessPoolBusy,
    pool_disabled,
    subprocess_metrics_snapshot,
    subprocess_slot,
    subprocess_slot_sync,
)
from oaao_orchestrator.vault_job_contract import hook_id_to_kind, job_dict_to_envelope
from oaao_orchestrator.vault_job_idle import vault_job_idle_sleep_seconds


def test_vault_job_idle_backoff_grows_then_caps() -> None:
    assert vault_job_idle_sleep_seconds(empty_streak=0, base_interval=4.0) == 0.2
    s2 = vault_job_idle_sleep_seconds(empty_streak=2, base_interval=4.0)
    s5 = vault_job_idle_sleep_seconds(empty_streak=5, base_interval=4.0)
    assert s2 < s5 <= 16.0


def test_hook_id_to_kind_mapping() -> None:
    assert hook_id_to_kind("vh.rag.document_embed") == "embed"
    env = job_dict_to_envelope({"job_id": 9, "hook_id": "vh.rag.audio_asr", "payload": {}})
    assert env["kind"] == "asr"
    assert env["protocol_version"] == "1"


@pytest.mark.asyncio
async def test_subprocess_lane_limits_concurrency(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OAAO_SUBPROC_MAX_FFMPEG", "1")
    monkeypatch.delenv("OAAO_SUBPROC_POOL_DISABLED", raising=False)

    async def hold() -> None:
        async with subprocess_slot(lane="ffmpeg"):
            await asyncio.sleep(0.05)

    await asyncio.gather(hold(), hold())
    snap = subprocess_metrics_snapshot()
    assert snap["lanes"]["ffmpeg"]["total_started"] >= 2


def test_subprocess_non_blocking_rejects_when_saturated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OAAO_SUBPROC_MAX_DOCKER", "1")
    monkeypatch.delenv("OAAO_SUBPROC_POOL_DISABLED", raising=False)

    with subprocess_slot_sync(lane="docker"):
        with pytest.raises(SubprocessPoolBusy):
            with subprocess_slot_sync(lane="docker", blocking=False):
                pass


def test_subprocess_pool_disabled_passthrough(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OAAO_SUBPROC_POOL_DISABLED", "1")
    assert pool_disabled() is True

    async def _run() -> None:
        async with subprocess_slot(lane="ffmpeg"):
            return

    asyncio.run(_run())
