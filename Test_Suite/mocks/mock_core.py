"""
Minimal in-process Core harness — drive the orchestrator pipeline without
booting FastAPI / PHP. Used by integration + smoke tests.

The harness does NOT speak HTTP; it constructs the same domain objects that
`run_executor.execute_chat_run` would receive from `app.py`, then drives a
single agent through `AgentRegistry.run(...)` (or a manually-built loop).

Real upstream LLM calls are blocked — pass an `LlmMock` if any agent code
path would otherwise reach the network.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from oaao_orchestrator.agents.registry import (
    AgentResult,
    AgentRunner,
    get_agent_registry,
    register_agent,
    reset_agent_registry_for_tests,
)
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.models import RunTaskSpec, RunTaskType


@dataclass
class CapturedEnvelope:
    phase: str
    kind: str
    step_id: str | None
    text: str | None
    payload: dict[str, Any]


class MockCore:
    """Captures all stream envelopes + agent results during a run."""

    def __init__(self, run_id: str = "mock-core-run") -> None:
        self.run = StreamRun(run_id)
        self.envelopes: list[CapturedEnvelope] = []
        self._patch_append()

    def _patch_append(self) -> None:
        original = self.run.append

        async def _capturing_append(envelope: Any) -> None:
            self.envelopes.append(
                CapturedEnvelope(
                    phase=getattr(envelope, "phase", ""),
                    kind=str(getattr(envelope, "kind", "")),
                    step_id=getattr(envelope, "step_id", None),
                    text=getattr(envelope, "text", None),
                    payload=dict(getattr(envelope, "payload", {}) or {}),
                )
            )
            await original(envelope)

        # type: ignore[method-assign]
        self.run.append = _capturing_append  # noqa: SLF001

    def register(self, runner: AgentRunner) -> None:
        register_agent(runner)

    async def run_agent(
        self,
        *,
        agent_kind: str,
        task_id: str = "rt-1",
        title: str = "test task",
        ctx: RunContext | None = None,
    ) -> AgentResult:
        spec = RunTaskSpec(
            id=task_id,
            title=title,
            type=RunTaskType.AGENT,
            agent_kind=agent_kind,
        )
        return await get_agent_registry().run(
            run=self.run,
            run_task=spec,
            ctx=ctx or RunContext(),
        )

    def envelopes_by_phase(self, phase: str) -> list[CapturedEnvelope]:
        return [e for e in self.envelopes if e.phase == phase]

    def envelopes_by_kind(self, kind: str) -> list[CapturedEnvelope]:
        return [e for e in self.envelopes if e.kind == kind]

    def reset(self) -> None:
        self.envelopes.clear()
        reset_agent_registry_for_tests()


@dataclass
class StubAgent:
    """Minimal AgentRunner that records calls and returns a canned AgentResult."""

    agent_kind: str
    result: AgentResult = field(default_factory=lambda: AgentResult(success=True))
    calls: list[tuple[str, str]] = field(default_factory=list)

    async def run(self, *, run, run_task, ctx) -> AgentResult:  # noqa: ANN001
        self.calls.append((run_task.id, run_task.agent_kind or ""))
        return self.result


@dataclass
class BoomAgent:
    """Agent that raises — used in resilience tests."""

    agent_kind: str = "boom"
    exc: BaseException = field(default_factory=lambda: RuntimeError("boom"))

    async def run(self, *, run, run_task, ctx) -> AgentResult:  # noqa: ANN001
        raise self.exc
