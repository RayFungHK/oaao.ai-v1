"""Cooperative cancel — skip pending run tasks and emit checklist + system status."""

from __future__ import annotations

from typing import Any

from oaao_orchestrator.streaming.events import PHASE_SYSTEM, StreamEnvelope
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskStatus
from oaao_orchestrator.tasks.stream_emit import emit_task_list_status


def mark_pending_tasks_skipped(queue: list[RunTaskSpec]) -> None:
    for task in queue:
        if task.status == RunTaskStatus.PENDING:
            task.status = RunTaskStatus.SKIPPED


async def emit_run_cancelled(
    run: StreamRun,
    plan: RunPlan | None,
    *,
    pipeline_snap: dict[str, Any] | None,
    pending_queue: list[RunTaskSpec] | None = None,
) -> None:
    if pending_queue:
        mark_pending_tasks_skipped(pending_queue)
    if plan is not None:
        total = len(plan.tasks)
        for i, spec in enumerate(plan.tasks, start=1):
            spec.index = i
            spec.total = total
        await emit_task_list_status(run, plan, pipeline_snap=pipeline_snap, text="run_cancelled")
    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind="status",
            text="run_cancelled",
            payload={"cancelled": True},
        )
    )
