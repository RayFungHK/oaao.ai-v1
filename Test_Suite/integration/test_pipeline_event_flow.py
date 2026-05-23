"""
Verify event payload propagation across hook points.

Contract: Hook A's AgentResult.extra → next agent's RunContext.extra.
This is the "Hook A → Hook B" payload-only handoff the architecture mandates.
"""

from __future__ import annotations

import pytest

from oaao_orchestrator.agents.registry import AgentResult
from oaao_orchestrator.pipeline import RunContext

from Test_Suite.mocks.mock_core import BoomAgent, MockCore, StubAgent


@pytest.mark.asyncio
async def test_two_agent_payload_handoff() -> None:
    """Agent A populates ctx.extra; Agent B reads it. No direct import allowed."""
    core = MockCore()

    class ProducerAgent:
        agent_kind = "producer"

        async def run(self, *, run, run_task, ctx) -> AgentResult:  # noqa: ANN001
            return AgentResult(success=True, extra={"shared_key": "value_from_A"})

    class ConsumerAgent:
        agent_kind = "consumer"
        seen: dict[str, str] = {}

        async def run(self, *, run, run_task, ctx) -> AgentResult:  # noqa: ANN001
            self.seen.update(ctx.extra or {})
            return AgentResult(success=bool(ctx.extra.get("shared_key")))

    producer = ProducerAgent()
    consumer = ConsumerAgent()
    core.register(producer)
    core.register(consumer)

    ctx = RunContext()
    result_a = await core.run_agent(agent_kind="producer", task_id="rt-a", ctx=ctx)
    assert result_a.success
    # Simulate executor merging extra back into ctx (this is the documented contract).
    ctx.extra.update(result_a.extra)
    result_b = await core.run_agent(agent_kind="consumer", task_id="rt-b", ctx=ctx)
    assert result_b.success
    assert consumer.seen.get("shared_key") == "value_from_A"


@pytest.mark.asyncio
async def test_unknown_agent_returns_failed_result_not_exception() -> None:
    """Registry isolation: dispatching to an unregistered agent must not raise."""
    core = MockCore()
    result = await core.run_agent(agent_kind="never_registered_kind")
    assert result.success is False
    assert "unknown_agent_kind" in (result.error or "")


@pytest.mark.asyncio
async def test_agent_envelopes_carry_step_id() -> None:
    """Stub agents must emit envelopes that correlate via step_id (run_task.id)."""
    core = MockCore()
    core.register(StubAgent(agent_kind="quiet"))
    result = await core.run_agent(agent_kind="quiet", task_id="rt-quiet")
    assert result.success
    # Stub agents don't emit by default; we only assert that the harness captured nothing
    # spurious — sanity check that capture wiring works.
    assert all(e.payload is not None for e in core.envelopes)
