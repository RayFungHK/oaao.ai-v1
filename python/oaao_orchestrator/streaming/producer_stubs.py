"""Example producer pushing phased envelopes — bind to real Pipeline steps."""

from __future__ import annotations

import asyncio

from oaao_orchestrator.streaming.events import (
    PHASE_AGENT,
    PHASE_LLM,
    PHASE_RAG,
    PHASE_SANDBOX,
    StreamEnvelope,
)
from oaao_orchestrator.streaming.session import StreamRun


async def demo_fill_run(run: StreamRun) -> None:
    """Toy timeline — replace with agent/MCP/RAG/Web hooks emitting ``StreamEnvelope``."""
    await asyncio.sleep(0)
    await run.append(StreamEnvelope(phase=PHASE_AGENT, kind="status", text="Planning next steps…"))
    await run.append(StreamEnvelope(phase=PHASE_RAG, kind="start", text="Retrieving context"))
    await run.append(StreamEnvelope(phase=PHASE_RAG, kind="end", text="Retrieval complete"))
    await run.append(
        StreamEnvelope(phase=PHASE_SANDBOX, kind="status", text="Running sandbox command")
    )
    await run.append(StreamEnvelope(phase=PHASE_LLM, kind="delta", text="Hello "))
    await run.append(StreamEnvelope(phase=PHASE_LLM, kind="delta", text="world"))
    run.mark_done()
