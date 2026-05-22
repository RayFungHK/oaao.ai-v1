"""Phase 5 — cancel, since_seq replay, artifact aggregation helpers."""

from __future__ import annotations

import pytest

from oaao_orchestrator.pipeline_ui import build_minimal_pipeline_snapshot
from oaao_orchestrator.streaming.events import KIND_END, KIND_START, KIND_STATUS, PHASE_SYSTEM, PHASE_TASK
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.cancel import emit_run_cancelled
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskStatus, RunTaskType
from oaao_orchestrator.tasks.stream_emit import emit_run_task_end, emit_run_task_start, emit_task_list_status


@pytest.mark.asyncio
async def test_stream_run_request_cancel() -> None:
    run = StreamRun("p5-cancel-flag")
    assert not run.cancelled
    run.request_cancel()
    assert run.cancelled


@pytest.mark.asyncio
async def test_since_seq_replays_task_checklist() -> None:
    run = StreamRun("p5-replay")
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
    snap = build_minimal_pipeline_snapshot(task_id="pipe-task-uuid")
    await emit_task_list_status(run, plan, pipeline_snap=snap, text="task_plan")

    first = run_task = plan.tasks[0]
    first.status = RunTaskStatus.ACTIVE
    await emit_run_task_start(run, plan, first, pipeline_snap=snap)
    first.status = RunTaskStatus.DONE
    await emit_run_task_end(run, plan, first, pipeline_snap=snap)

    full = run.snapshot_since(0)
    assert len(full) >= 3
    task_frames = [env for _, env in full if env.phase == PHASE_TASK]
    assert any(env.kind == KIND_STATUS for env in task_frames)
    assert any(env.kind == KIND_START for env in task_frames)
    assert any(env.kind == KIND_END for env in task_frames)

    status_env = next(env for _, env in full if env.phase == PHASE_TASK and env.kind == KIND_STATUS)
    tasks_payload = (status_env.payload or {}).get("tasks")
    assert isinstance(tasks_payload, dict)
    assert len(tasks_payload.get("items") or []) == 2

    after_plan = run.snapshot_since(1)
    assert len(after_plan) < len(full)
    assert all(sid > 1 for sid, _ in after_plan)

    reconnect = run.snapshot_since(2)
    assert reconnect
    assert all(env.phase == PHASE_TASK for _, env in reconnect[:2])


@pytest.mark.asyncio
async def test_emit_run_cancelled_updates_checklist() -> None:
    run = StreamRun("p5-cancel-emit")
    plan = RunPlan(
        tasks=[
            RunTaskSpec(id="rt-a", title="Step A", type=RunTaskType.EMIT),
            RunTaskSpec(id="rt-b", title="Step B", type=RunTaskType.EMIT),
        ],
    )
    plan.tasks[1].status = RunTaskStatus.PENDING
    pending = [plan.tasks[1]]
    await emit_run_cancelled(run, plan, pipeline_snap=None, pending_queue=pending)
    assert plan.tasks[1].status == RunTaskStatus.SKIPPED
    system = [env for _, env in run._events if env.phase == PHASE_SYSTEM]
    assert any(env.text == "run_cancelled" for env in system)
    task_status = [env for _, env in run._events if env.phase == PHASE_TASK and env.kind == KIND_STATUS]
    assert any(env.text == "run_cancelled" for env in task_status)
