"""Agent / agent-task frames on ``StreamRun`` (Phase 3+)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from oaao_orchestrator.streaming.events import KIND_END, KIND_PROGRESS, KIND_START, StreamEnvelope
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.models import (
    AgentSpec,
    AgentStatus,
    AgentTaskSpec,
    AgentTaskStatus,
    AgentView,
    AgentTaskView,
    RunPlan,
    RunTaskSpec,
)
from oaao_orchestrator.tasks.stream_emit import (
    merge_agent_tasks_into_task_list,
    merge_slide_worker_row,
)


def _upsert_agent_task_row(
    accum: list[dict[str, Any]],
    agent_task: AgentTaskSpec,
) -> None:
    """Keep one row per agent sub-step id (running → done/failed)."""
    preview = None
    if isinstance(agent_task.params, dict):
        raw = agent_task.params.get("preview")
        if isinstance(raw, dict):
            preview = raw
    row: dict[str, Any] = {
        "id": agent_task.id,
        "title": agent_task.title,
        "status": agent_task.status.value
        if hasattr(agent_task.status, "value")
        else str(agent_task.status),
    }
    if preview is not None:
        row["preview"] = preview
    for i, existing in enumerate(accum):
        if isinstance(existing, dict) and str(existing.get("id") or "") == agent_task.id:
            accum[i] = row
            return
    accum.append(row)


def _agent_payload(
    plan: RunPlan | None,
    run_task: RunTaskSpec | None,
    agent: AgentSpec,
    agent_task: AgentTaskSpec | None = None,
    *,
    allowed_agents: list[str] | None = None,
    pipeline_snap: dict[str, Any] | None = None,
    agent_tasks_accum: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "agent": AgentView(
            id=agent.id,
            run_task_id=agent.run_task_id,
            kind=agent.kind,
            status=agent.status,
        ).model_dump(),
    }
    if agent_task is not None:
        preview = None
        if isinstance(agent_task.params, dict):
            raw = agent_task.params.get("preview")
            if isinstance(raw, dict):
                preview = raw
        payload["agent_task"] = AgentTaskView(
            id=agent_task.id,
            agent_id=agent_task.agent_id,
            run_task_id=agent_task.run_task_id,
            title=agent_task.title,
            status=agent_task.status,
            preview=preview,
        ).model_dump()
    if plan is not None:
        task_list = plan.task_list_payload(allowed_agents=allowed_agents)
        if (
            agent_tasks_accum
            and run_task is not None
            and isinstance(task_list, dict)
        ):
            merge_agent_tasks_into_task_list(task_list, run_task.id, agent_tasks_accum)
        payload["tasks"] = task_list
        if run_task is not None:
            payload["run_task"] = plan.run_task_view(run_task)
    if pipeline_snap is not None:
        payload["oaao_pipeline"] = pipeline_snap
    return payload


async def emit_slide_worker_progress(
    run: StreamRun,
    *,
    phase: str,
    plan: RunPlan,
    run_task: RunTaskSpec,
    agent: AgentSpec,
    allowed_agents: list[str] | None = None,
    pipeline_snap: dict[str, Any] | None = None,
    status: str = "running",
    preview: dict[str, Any] | None = None,
    title: str | None = None,
) -> None:
    """Stream preview / status for one parallel slide page under the workers parent row."""
    task_list = plan.task_list_payload(allowed_agents=allowed_agents)
    merge_slide_worker_row(
        task_list,
        run_task,
        status=status,
        preview=preview,
        title=title or run_task.title,
    )
    payload: dict[str, Any] = {
        "tasks": task_list,
        "run_task": plan.run_task_view(run_task),
        "agent": AgentView(
            id=agent.id,
            run_task_id=agent.run_task_id,
            kind=agent.kind,
            status=agent.status,
        ).model_dump(),
        "agent_task": AgentTaskView(
            id=run_task.id,
            agent_id=agent.id,
            run_task_id=run_task.id,
            title=run_task.title,
            status=status,
            preview=preview,
        ).model_dump(),
    }
    if pipeline_snap is not None:
        payload["oaao_pipeline"] = pipeline_snap
    await run.append(
        StreamEnvelope(
            phase=phase,
            kind=KIND_PROGRESS,
            step_id=run_task.id,
            text=run_task.title,
            payload=payload,
        )
    )


async def emit_agent_start(
    run: StreamRun,
    *,
    phase: str,
    plan: RunPlan,
    run_task: RunTaskSpec,
    agent: AgentSpec,
    pipeline_snap: dict[str, Any] | None = None,
) -> None:
    await run.append(
        StreamEnvelope(
            phase=phase,
            kind=KIND_START,
            step_id=agent.id,
            text=run_task.title,
            payload=_agent_payload(plan, run_task, agent, pipeline_snap=pipeline_snap),
        )
    )


async def emit_agent_end(
    run: StreamRun,
    *,
    phase: str,
    plan: RunPlan,
    run_task: RunTaskSpec,
    agent: AgentSpec,
    pipeline_snap: dict[str, Any] | None = None,
    failed: bool = False,
    agent_tasks: list[dict[str, Any]] | None = None,
) -> None:
    agent.status = AgentStatus.FAILED if failed else AgentStatus.DONE
    await run.append(
        StreamEnvelope(
            phase=phase,
            kind=KIND_END,
            step_id=agent.id,
            text=run_task.title if not failed else f"{run_task.title} (failed)",
            payload=_agent_payload(
                plan,
                run_task,
                agent,
                pipeline_snap=pipeline_snap,
                agent_tasks_accum=agent_tasks,
            ),
        )
    )


async def emit_agent_task_progress(
    run: StreamRun,
    *,
    phase: str,
    plan: RunPlan,
    run_task: RunTaskSpec,
    agent: AgentSpec,
    agent_task: AgentTaskSpec,
    pipeline_snap: dict[str, Any] | None = None,
    agent_tasks_accum: list[dict[str, Any]] | None = None,
) -> None:
    await run.append(
        StreamEnvelope(
            phase=phase,
            kind=KIND_PROGRESS,
            step_id=agent_task.id,
            text=agent_task.title,
            payload=_agent_payload(
                plan,
                run_task,
                agent,
                agent_task,
                pipeline_snap=pipeline_snap,
                agent_tasks_accum=agent_tasks_accum,
            ),
        )
    )


async def run_agent_task_step(
    run: StreamRun,
    *,
    phase: str,
    plan: RunPlan,
    run_task: RunTaskSpec,
    agent: AgentSpec,
    agent_task: AgentTaskSpec,
    pipeline_snap: dict[str, Any] | None,
    work: Callable[[], Awaitable[None]],
    agent_tasks_accum: list[dict[str, Any]] | None = None,
) -> None:
    """Emit running → await work → emit done/failed progress."""
    if run.cancelled:
        agent_task.status = AgentTaskStatus.FAILED
        return
    agent_task.status = AgentTaskStatus.RUNNING
    if agent_tasks_accum is not None:
        _upsert_agent_task_row(agent_tasks_accum, agent_task)
    await emit_agent_task_progress(
        run,
        phase=phase,
        plan=plan,
        run_task=run_task,
        agent=agent,
        agent_task=agent_task,
        pipeline_snap=pipeline_snap,
        agent_tasks_accum=agent_tasks_accum,
    )
    try:
        await work()
        agent_task.status = AgentTaskStatus.DONE
    except Exception:
        agent_task.status = AgentTaskStatus.FAILED
        if agent_tasks_accum is not None:
            _upsert_agent_task_row(agent_tasks_accum, agent_task)
        await emit_agent_task_progress(
            run,
            phase=phase,
            plan=plan,
            run_task=run_task,
            agent=agent,
            agent_task=agent_task,
            pipeline_snap=pipeline_snap,
            agent_tasks_accum=agent_tasks_accum,
        )
        raise
    if agent_tasks_accum is not None:
        _upsert_agent_task_row(agent_tasks_accum, agent_task)
    await emit_agent_task_progress(
        run,
        phase=phase,
        plan=plan,
        run_task=run_task,
        agent=agent,
        agent_task=agent_task,
        pipeline_snap=pipeline_snap,
        agent_tasks_accum=agent_tasks_accum,
    )
