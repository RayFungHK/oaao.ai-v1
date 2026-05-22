"""
Vertical agent stubs (Phase 4) — agent / agent-task SSE + optional artifacts.

Real sandbox, slides export, image APIs, and MCP bridges land in later phases.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.events import PHASE_AGENT, PHASE_MCP, PHASE_SANDBOX, PHASE_WEB
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.agent_emit import emit_agent_end, emit_agent_start, run_agent_task_step
from oaao_orchestrator.tasks.models import (
    AgentResult,
    AgentSpec,
    AgentStatus,
    AgentTaskSpec,
    RunPlan,
    RunTaskSpec,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StubAgentDef:
    agent_kind: str
    phase: str
    steps: tuple[tuple[str, str], ...]
    artifacts: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    stub_note: str = ""


def _slides_artifacts(run_task_id: str) -> tuple[dict[str, Any], ...]:
    return (
        {
            "id": f"stub-slides-{run_task_id}",
            "name": "oaao_deck_stub.pptx",
            "mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "size_bytes": 0,
            "tool_id": "slides_export",
            "agent_kind": "slides",
            "run_task_id": run_task_id,
            "status": "stub",
        },
    )


def _image_artifacts(run_task_id: str) -> tuple[dict[str, Any], ...]:
    return (
        {
            "id": f"stub-image-{run_task_id}",
            "name": "generated_image_stub.png",
            "mime": "image/png",
            "size_bytes": 0,
            "tool_id": "image_gen",
            "agent_kind": "image_gen",
            "run_task_id": run_task_id,
            "status": "stub",
        },
    )


STUB_AGENT_DEFS: dict[str, StubAgentDef] = {
    "sandbox_code": StubAgentDef(
        agent_kind="sandbox_code",
        phase=PHASE_SANDBOX,
        steps=(
            ("prepare", "Prepare sandbox environment"),
            ("write", "Write project files"),
            ("run", "Execute and capture output"),
        ),
        stub_note="Sandbox code execution is stubbed — no commands were run.",
    ),
    "slides": StubAgentDef(
        agent_kind="slides",
        phase=PHASE_AGENT,
        steps=(
            ("outline", "Outline presentation"),
            ("content", "Generate slide content"),
            ("export", "Export deck artifact"),
        ),
        stub_note="Slide generation is stubbed — deck artifact is a placeholder.",
    ),
    "image_gen": StubAgentDef(
        agent_kind="image_gen",
        phase=PHASE_AGENT,
        steps=(
            ("prompt", "Refine image prompt"),
            ("generate", "Generate image"),
            ("attach", "Attach preview artifact"),
        ),
        stub_note="Image generation is stubbed — no image API was called.",
    ),
    "web_search": StubAgentDef(
        agent_kind="web_search",
        phase=PHASE_WEB,
        steps=(
            ("query", "Formulate search query"),
            ("fetch", "Fetch web snippets"),
            ("merge", "Merge results into context"),
        ),
        stub_note="Web search is stubbed — results were not fetched from the public web.",
    ),
    "mcp_tool": StubAgentDef(
        agent_kind="mcp_tool",
        phase=PHASE_MCP,
        steps=(
            ("discover", "Discover MCP tools"),
            ("invoke", "Invoke tool"),
            ("normalize", "Normalize tool output"),
        ),
        stub_note="MCP tool bridge is stubbed — no external tool was invoked.",
    ),
}


class StubVerticalAgent:
    """Configurable stub runner — one instance per ``agent_kind``."""

    def __init__(self, definition: StubAgentDef) -> None:
        self._def = definition

    @property
    def agent_kind(self) -> str:
        return self._def.agent_kind

    async def run(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
    ) -> AgentResult:
        d = self._def
        plan_raw = ctx.extra.get("run_plan")
        plan = plan_raw if isinstance(plan_raw, RunPlan) else RunPlan()
        pipeline_base = ctx.extra.get("pipeline_snap_base")
        pipeline_snap: dict[str, Any] = dict(pipeline_base) if isinstance(pipeline_base, dict) else {}

        agent = AgentSpec(
            id=f"ag-{run_task.id}",
            run_task_id=run_task.id,
            kind=d.agent_kind,
            status=AgentStatus.RUNNING,
        )
        await emit_agent_start(
            run,
            phase=d.phase,
            plan=plan,
            run_task=run_task,
            agent=agent,
            pipeline_snap=pipeline_snap or None,
        )

        total = len(d.steps)
        agent_tasks_accum: list[dict[str, Any]] = []
        try:
            if run.cancelled:
                return AgentResult(success=False, error="cancelled")
            for idx, (suffix, title) in enumerate(d.steps, start=1):
                if run.cancelled:
                    return AgentResult(success=False, error="cancelled")
                agent_task = AgentTaskSpec(
                    id=f"at-{run_task.id}-{suffix}",
                    title=title,
                    agent_id=agent.id,
                    run_task_id=run_task.id,
                    index=idx,
                    total=total,
                )

                async def _noop() -> None:
                    return None

                await run_agent_task_step(
                    run,
                    phase=d.phase,
                    plan=plan,
                    run_task=run_task,
                    agent=agent,
                    agent_task=agent_task,
                    pipeline_snap=pipeline_snap or None,
                    work=_noop,
                    agent_tasks_accum=agent_tasks_accum,
                )

            artifacts = self._build_artifacts(run_task)
            if d.stub_note:
                self._append_stub_system_note(ctx, d.stub_note)

            await emit_agent_end(
                run,
                phase=d.phase,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
            )
            return AgentResult(
                success=True,
                artifacts=artifacts,
                extra={"stub": True, "agent_kind": d.agent_kind},
            )
        except Exception as exc:
            logger.exception("stub_agent_failed kind=%s run_task=%s", d.agent_kind, run_task.id)
            await emit_agent_end(
                run,
                phase=d.phase,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
                failed=True,
            )
            return AgentResult(success=False, error=str(exc)[:400])

    def _build_artifacts(self, run_task: RunTaskSpec) -> list[dict[str, Any]]:
        if self._def.agent_kind == "slides":
            return list(_slides_artifacts(run_task.id))
        if self._def.agent_kind == "image_gen":
            return list(_image_artifacts(run_task.id))
        return [dict(a) for a in self._def.artifacts]

    @staticmethod
    def _append_stub_system_note(ctx: RunContext, note: str) -> None:
        if not note.strip():
            return
        messages = list(ctx.messages)
        block = f"[{note.strip()}]"
        if messages and str(messages[0].get("role") or "").lower() == "system":
            prev = messages[0].get("content")
            messages[0]["content"] = (
                f"{block}\n\n{prev}" if isinstance(prev, str) and prev.strip() else block
            )
        else:
            messages.insert(0, {"role": "system", "content": block})
        ctx.messages = messages


def stub_agent_factory(agent_kind: str):
    def _factory() -> StubVerticalAgent:
        definition = STUB_AGENT_DEFS.get(agent_kind)
        if definition is None:
            raise ValueError(f"unknown stub agent_kind={agent_kind!r}")
        return StubVerticalAgent(definition)

    return _factory
