"""Phase 0 — task models and agent registry skeleton."""

from __future__ import annotations

import pytest

from oaao_orchestrator.agents.registry import (
    AgentRegistry,
    AgentResult,
    AgentRunner,
    build_agent_registry,
    get_agent_registry,
    register_agent,
    reset_agent_registry_for_tests,
)
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.events import KIND_PROGRESS, PHASE_TASK, PHASES
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskStatus, RunTaskType


def test_phase_task_in_phases() -> None:
    assert PHASE_TASK in PHASES
    assert KIND_PROGRESS == "progress"


def test_run_plan_task_list_payload() -> None:
    plan = RunPlan(
        tasks=[
            RunTaskSpec(
                id="rt-1",
                title="Retrieve vault",
                type=RunTaskType.VAULT_RAG,
                index=1,
                total=2,
            ),
            RunTaskSpec(
                id="rt-2",
                title="Answer",
                type=RunTaskType.LLM_STREAM,
                index=2,
                total=2,
            ),
        ],
    )
    payload = plan.task_list_payload()
    assert len(payload["items"]) == 2
    assert payload["items"][0]["status"] == RunTaskStatus.PENDING


@pytest.mark.asyncio
async def test_agent_registry_unknown_kind() -> None:
    reset_agent_registry_for_tests()
    reg = get_agent_registry()
    from oaao_orchestrator.streaming.session import StreamRun

    run = StreamRun("test-run")
    spec = RunTaskSpec(id="rt-1", title="Unknown", type=RunTaskType.AGENT, agent_kind="not_registered_agent")
    result = await reg.run(run=run, run_task=spec, ctx=RunContext())
    assert result.success is False
    assert "unknown_agent_kind" in (result.error or "")


@pytest.mark.asyncio
async def test_register_agent_hook() -> None:
    reset_agent_registry_for_tests()

    class _StubSlides:
        agent_kind = "slides"

        async def run(self, *, run, run_task, ctx) -> AgentResult:  # noqa: ANN001
            return AgentResult(success=True, extra={"slides": 1})

    register_agent(_StubSlides())
    reg = get_agent_registry()
    assert "slides" in reg.kinds()

    from oaao_orchestrator.streaming.session import StreamRun

    run = StreamRun("test-run-2")
    spec = RunTaskSpec(id="rt-1", title="PPT", type=RunTaskType.AGENT, agent_kind="slides")
    result = await reg.run(run=run, run_task=spec, ctx=RunContext())
    assert result.success is True
    assert result.extra.get("slides") == 1

    reset_agent_registry_for_tests()
