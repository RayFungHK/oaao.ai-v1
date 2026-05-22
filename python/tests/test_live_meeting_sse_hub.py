from __future__ import annotations

import asyncio

import pytest

from oaao_orchestrator.live_meeting.sse_hub import LiveStreamHub
from oaao_orchestrator.streaming.events import KIND_LIVE_TRANSCRIPT, PHASE_LIVE, StreamEnvelope


@pytest.mark.asyncio
async def test_live_stream_hub_replays_and_tails() -> None:
    hub = LiveStreamHub("lm_test")
    await hub.append(
        StreamEnvelope(
            phase=PHASE_LIVE,
            kind=KIND_LIVE_TRANSCRIPT,
            text="hello",
            payload={"is_final": True, "segment": 1},
        )
    )

    chunks: list[str] = []

    async def collect() -> None:
        async for chunk in hub.subscribe(0):
            chunks.append(chunk)
            if "hello" in chunk:
                break

    await asyncio.wait_for(collect(), timeout=2.0)
    assert any("live_transcript" in c or "hello" in c for c in chunks)
