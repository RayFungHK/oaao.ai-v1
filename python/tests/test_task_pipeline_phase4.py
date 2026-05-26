"""Phase 4 — vertical agent stubs + allowed_agents registry."""

from __future__ import annotations

import pytest
from oaao_orchestrator.agents.registry import get_agent_registry, reset_agent_registry_for_tests
from oaao_orchestrator.agents.stub_vertical import STUB_AGENT_DEFS, StubVerticalAgent
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.events import PHASE_SANDBOX
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType


@pytest.fixture(autouse=True)
def _fresh_registry() -> None:
    reset_agent_registry_for_tests()


def test_stub_agents_registered() -> None:
    reg = get_agent_registry()
    for kind in STUB_AGENT_DEFS:
        assert kind in reg.kinds()
        assert reg.get(kind) is not None


@pytest.mark.asyncio
async def test_sandbox_stub_emits_sandbox_phase() -> None:
    run = StreamRun("phase4-sandbox")
    plan = RunPlan(
        tasks=[
            RunTaskSpec(
                id="rt-sandbox",
                title="Run code in sandbox",
                type=RunTaskType.AGENT,
                agent_kind="sandbox_code",
            ),
        ],
    )
    run_task = plan.tasks[0]
    ctx = RunContext(
        messages=[{"role": "user", "content": "write a script"}], extra={"run_plan": plan}
    )
    agent = StubVerticalAgent(STUB_AGENT_DEFS["sandbox_code"])
    result = await agent.run(run=run, run_task=run_task, ctx=ctx)
    assert result.success is True
    progress = [e for _, e in run._events if e.phase == PHASE_SANDBOX and e.kind == "progress"]
    assert len(progress) >= 3
    assert any(
        "[Sandbox code execution is stubbed" in str(m.get("content", "")) for m in ctx.messages
    )


@pytest.mark.asyncio
async def test_slides_stub_returns_artifacts() -> None:
    run = StreamRun("phase4-slides")
    run_task = RunTaskSpec(
        id="rt-slides",
        title="Create presentation",
        type=RunTaskType.AGENT,
        agent_kind="slides",
    )
    ctx = RunContext(extra={"run_plan": RunPlan()})
    agent = StubVerticalAgent(STUB_AGENT_DEFS["slides"])
    result = await agent.run(run=run, run_task=run_task, ctx=ctx)
    assert result.success is True
    assert result.artifacts
    assert result.artifacts[0].get("mime", "").startswith("application/vnd.openxmlformats")


@pytest.mark.asyncio
async def test_registry_runs_slides_stub() -> None:
    reg = get_agent_registry()
    run = StreamRun("phase4-slides-reg")
    run_task = RunTaskSpec(
        id="rt-slides-2",
        title="Slides",
        type=RunTaskType.AGENT,
        agent_kind="slides",
    )
    result = await reg.run(
        run=run,
        run_task=run_task,
        ctx=RunContext(extra={"run_plan": RunPlan()}),
    )
    assert result.success is True
    assert result.artifacts
