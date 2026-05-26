"""Top-20 #6 phase 11 — slide-page parallel-fanout dispatch extracted.

When a parallel batch popped from the task queue is composed of slide-page
tasks, ``execute_chat_run`` previously inlined ~135 LOC to inject the
project id, sync manifest titles, fan the page tasks out under a worker
semaphore, then close the batch with cancel / status envelopes. That whole
block now lives in :func:`handle_slide_page_batch` and the caller collapses
to a single ``await`` plus a tiny control flag dance.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Literal

from oaao_orchestrator.agents import get_agent_registry
from oaao_orchestrator.run_executor_plan import (
    inject_slide_project_id as _inject_slide_project_id,
)
from oaao_orchestrator.run_executor_plan import (
    reindex_plan as _reindex_plan,
)
from oaao_orchestrator.run_executor_plan import (
    slide_worker_concurrency as _slide_worker_concurrency,
)
from oaao_orchestrator.run_executor_timing import (
    finalize_run_task_timing as _finalize_run_task_timing,
)
from oaao_orchestrator.safety.agent_timeout import run_agent_with_timeout
from oaao_orchestrator.tasks.cancel import emit_run_cancelled
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskStatus
from oaao_orchestrator.tasks.stream_emit import (
    emit_run_task_end,
    emit_run_task_start,
    emit_task_list_status,
    ensure_run_task_agent_kind,
)

logger = logging.getLogger(__name__)

SlideFanoutControl = Literal["continue", "break"]


async def handle_slide_page_batch(
    *,
    parallel_batch: list[RunTaskSpec],
    run: Any,
    run_ctx: Any,
    plan: RunPlan,
    allowed_agents: Any,
    pipeline_snap: dict[str, Any] | None,
    pipeline_timing: dict[str, Any],
    task_queue: list[RunTaskSpec],
    cancel_emitted: bool,
) -> tuple[bool, bool, SlideFanoutControl]:
    """Run a batch of slide-page tasks concurrently.

    Returns ``(run_failed_flag, cancel_emitted, control)``:

    * ``run_failed_flag`` — True iff any page task failed/raised.
    * ``cancel_emitted`` — possibly updated cancel flag.
    * ``control`` — ``"break"`` if caller should leave the dispatch loop
      (cancellation just emitted), ``"continue"`` otherwise.
    """
    pid = run_ctx.extra.get("slide_project_id")
    if isinstance(pid, str):
        _inject_slide_project_id(parallel_batch, pid)
        try:
            from pathlib import Path

            from oaao_orchestrator.slide_project.fanout import (
                apply_manifest_titles_to_page_tasks,
            )
            from oaao_orchestrator.slide_project.store import SlideProjectStore

            sd_cfg = run_ctx.extra.get("slide_designer")
            root = None
            if isinstance(sd_cfg, dict) and isinstance(sd_cfg.get("storage_root"), str):
                root = Path(sd_cfg["storage_root"].strip())
            manifest = SlideProjectStore(root=root).load_manifest(pid)
            if isinstance(manifest, dict):
                apply_manifest_titles_to_page_tasks(plan.tasks, manifest)
        except Exception:
            logger.exception("slide_page_title_sync_failed project_id=%s", pid)
    for t in parallel_batch:
        t.status = RunTaskStatus.PENDING
    _reindex_plan(plan)
    await emit_task_list_status(
        run,
        plan,
        allowed_agents=allowed_agents,
        pipeline_snap=pipeline_snap,
        text="slide_fanout_skeleton",
    )
    sem = asyncio.Semaphore(_slide_worker_concurrency())

    async def _run_slide_page_task(page_task: RunTaskSpec) -> bool:
        async with sem:
            page_t0 = time.perf_counter()
            if run.cancelled:
                page_task.status = RunTaskStatus.SKIPPED
                page_ms = _finalize_run_task_timing(
                    pipeline_timing=pipeline_timing,
                    run_task=page_task,
                    task_t0=page_t0,
                )
                await emit_run_task_end(
                    run,
                    plan,
                    page_task,
                    allowed_agents=allowed_agents,
                    pipeline_snap=pipeline_snap,
                    duration_ms=page_ms,
                )
                return True
            ensure_run_task_agent_kind(page_task)
            page_task.status = RunTaskStatus.ACTIVE
            _reindex_plan(plan)
            await emit_run_task_start(
                run,
                plan,
                page_task,
                allowed_agents=allowed_agents,
                pipeline_snap=pipeline_snap,
            )
            failed = False
            try:
                run_ctx.extra["run_plan"] = plan
                run_ctx.extra["pipeline_snap_base"] = (
                    dict(pipeline_snap) if isinstance(pipeline_snap, dict) else {}
                )
                agent_result = await run_agent_with_timeout(
                    get_agent_registry().run,
                    run=run,
                    run_task=page_task,
                    ctx=run_ctx,
                )
                sp = agent_result.extra.get("slide_project")
                if isinstance(sp, dict) and sp.get("project_id"):
                    run_ctx.extra["slide_project_id"] = str(sp["project_id"])
                if not agent_result.success:
                    failed = True
            except Exception:
                logger.exception("slide_page_task_failed run_task=%s", page_task.id)
                failed = True
            finally:
                page_task.status = (
                    RunTaskStatus.FAILED if failed else RunTaskStatus.DONE
                )
                page_ms = _finalize_run_task_timing(
                    pipeline_timing=pipeline_timing,
                    run_task=page_task,
                    task_t0=page_t0,
                )
                await emit_run_task_end(
                    run,
                    plan,
                    page_task,
                    allowed_agents=allowed_agents,
                    pipeline_snap=pipeline_snap,
                    failed=failed,
                    duration_ms=page_ms,
                )
            return failed

    results = await asyncio.gather(
        *[_run_slide_page_task(t) for t in parallel_batch],
        return_exceptions=True,
    )
    run_failed_flag = False
    for r in results:
        if isinstance(r, Exception) or r is True:
            run_failed_flag = True
    _reindex_plan(plan)
    await emit_task_list_status(
        run,
        plan,
        allowed_agents=allowed_agents,
        pipeline_snap=pipeline_snap,
        text="slide_fanout_pages_done",
    )
    if run.cancelled and not cancel_emitted:
        await emit_run_cancelled(
            run,
            plan,
            pipeline_snap=pipeline_snap,
            pending_queue=task_queue,
        )
        return run_failed_flag, True, "break"
    return run_failed_flag, cancel_emitted, "continue"
