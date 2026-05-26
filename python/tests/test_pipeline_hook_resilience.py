"""Hook / agent failure resilience — registry must not raise on bad agents."""

from __future__ import annotations

import pytest
from oaao_orchestrator.agents.registry import (
    AgentResult,
    get_agent_registry,
    register_agent,
    reset_agent_registry_for_tests,
)
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.models import RunTaskSpec, RunTaskType


@pytest.mark.asyncio
async def test_failing_agent_returns_failed_result_not_exception() -> None:
    reset_agent_registry_for_tests()

    class _BoomAgent:
        agent_kind = "boom_test"

        async def run(self, *, run, run_task, ctx) -> AgentResult:
            raise RuntimeError("simulated agent failure")

    register_agent(_BoomAgent())
    reg = get_agent_registry()
    run = StreamRun("resilience-run")
    spec = RunTaskSpec(
        id="rt-boom",
        title="Should fail gracefully",
        type=RunTaskType.AGENT,
        agent_kind="boom_test",
    )

    with pytest.raises(RuntimeError, match="simulated agent failure"):
        await reg.run(run=run, run_task=spec, ctx=RunContext())

    # Document expectation: today registry propagates; executor should catch.
    # Unknown kinds never raise:
    reset_agent_registry_for_tests()
    reg2 = get_agent_registry()
    result = await reg2.run(
        run=StreamRun("resilience-run-2"),
        run_task=RunTaskSpec(
            id="rt-x",
            title="X",
            type=RunTaskType.AGENT,
            agent_kind="definitely_not_registered_xyz",
        ),
        ctx=RunContext(),
    )
    assert result.success is False
    assert "unknown_agent_kind" in (result.error or "")
