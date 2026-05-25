"""Per-agent execution timeout (Audit §6.2 / HR-3)."""

from __future__ import annotations

import asyncio
import os

from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.models import AgentResult, RunTaskSpec


def agent_call_timeout_s() -> float:
    raw = (os.environ.get("OAAO_AGENT_TIMEOUT_SEC") or "300").strip()
    try:
        return max(5.0, min(3600.0, float(raw)))
    except (TypeError, ValueError):
        return 300.0


async def run_agent_with_timeout(
    registry_run,
    *,
    run: StreamRun,
    run_task: RunTaskSpec,
    ctx: RunContext,
    agent_kind: str | None = None,
) -> AgentResult:
    timeout = agent_call_timeout_s()
    kind = (agent_kind or run_task.agent_kind or "").strip() or "agent"
    try:
        return await asyncio.wait_for(
            registry_run(run=run, run_task=run_task, ctx=ctx, agent_kind=agent_kind),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        return AgentResult(success=False, error=f"timeout:{kind}")
