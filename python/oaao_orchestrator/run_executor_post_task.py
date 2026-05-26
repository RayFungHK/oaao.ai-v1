"""Top-20 #6 phase 12 — post-dispatch task housekeeping extracted.

After each dispatch branch (VAULT_RAG / ATTACHMENTS / AGENT / LLM_CALL /
LLM_STREAM / EMIT / unknown), :func:`execute_chat_run` previously inlined a
common tail covering status transitions, inter-agent handoff, task-end
envelope, cancellation handshake, and the planner_llm report-result replan.
That tail now lives in :func:`finalize_dispatched_task`; the caller hands it
the live mutable state and reads back the few scalars that may flip.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from oaao_orchestrator.agent_phase_handoff import maybe_inter_agent_handoff
from oaao_orchestrator.planner_llm import plan_report_result_tasks, planner_enabled
from oaao_orchestrator.run_executor_plan import (
    append_tasks_to_plan as _append_tasks_to_plan,
)
from oaao_orchestrator.run_executor_timing import (
    finalize_run_task_timing as _finalize_run_task_timing,
)
from oaao_orchestrator.tasks.cancel import emit_run_cancelled
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskStatus, RunTaskType
from oaao_orchestrator.tasks.stream_emit import emit_run_task_end, emit_task_list_status

logger = logging.getLogger(__name__)

DispatchControl = Literal["continue", "break"]


async def finalize_dispatched_task(
    *,
    run: Any,
    req: Any,
    run_task: RunTaskSpec,
    plan: RunPlan,
    task_queue: list[RunTaskSpec],
    run_ctx: Any,
    messages_for_llm: list[Any],
    allowed_agents: Any,
    pipeline_snap: dict[str, Any] | None,
    pipeline_timing: dict[str, Any],
    planner_url: str,
    planner_api_key: str | None,
    planner_model: str | None,
    api_key: str | None,
    task_t0: float,
    task_failed: bool,
    run_failed: bool,
    cancel_emitted: bool,
    report_replan_done: bool,
    report_after_ids: set[int],
) -> tuple[dict[str, Any] | None, bool, bool, bool, DispatchControl]:
    """Run the post-dispatch tail for one task.

    Returns ``(pipeline_snap, run_failed, cancel_emitted, report_replan_done,
    control)``. ``control`` is ``"break"`` when the dispatch loop should
    leave (cancellation just emitted), ``"continue"`` otherwise.
    """
    if run.cancelled:
        run_task.status = RunTaskStatus.SKIPPED
        task_failed = True
        run_failed = True
    elif task_failed:
        run_task.status = RunTaskStatus.FAILED
    else:
        run_task.status = RunTaskStatus.DONE
        if not task_failed and run_task.type == RunTaskType.AGENT and not run.cancelled:
            handoff_snap = await maybe_inter_agent_handoff(
                run,
                req,
                plan=plan,
                completed_task=run_task,
                task_queue=task_queue,
                messages=messages_for_llm,
                chat_completions_url=planner_url,
                api_key=api_key,
                model=planner_model,
                pipeline_snap=pipeline_snap,
                allowed_agents=allowed_agents,
            )
            if handoff_snap is not None:
                pipeline_snap = handoff_snap
                run_ctx.messages = list(messages_for_llm)
    task_duration_ms = _finalize_run_task_timing(
        pipeline_timing=pipeline_timing,
        run_task=run_task,
        task_t0=task_t0,
    )
    await emit_run_task_end(
        run,
        plan,
        run_task,
        allowed_agents=allowed_agents,
        pipeline_snap=pipeline_snap,
        failed=task_failed,
        duration_ms=task_duration_ms,
    )

    if run.cancelled:
        if not cancel_emitted:
            await emit_run_cancelled(
                run,
                plan,
                pipeline_snap=pipeline_snap,
                pending_queue=task_queue,
            )
            cancel_emitted = True
        return pipeline_snap, run_failed, cancel_emitted, report_replan_done, "break"

    if (
        planner_enabled(req)
        and not report_replan_done
        and not task_failed
        and run_task.id in report_after_ids
    ):
        report_replan_done = True
        extra_tasks = await plan_report_result_tasks(
            req,
            completed_task=run_task,
            chat_completions_url=planner_url,
            api_key=planner_api_key,
            model=planner_model,
            allowed_agents=allowed_agents,
            remaining_tasks=task_queue,
        )
        if extra_tasks:
            _append_tasks_to_plan(plan, task_queue, extra_tasks)
            await emit_task_list_status(
                run,
                plan,
                allowed_agents=allowed_agents,
                pipeline_snap=pipeline_snap,
                text="report_result",
            )

    return pipeline_snap, run_failed, cancel_emitted, report_replan_done, "continue"
