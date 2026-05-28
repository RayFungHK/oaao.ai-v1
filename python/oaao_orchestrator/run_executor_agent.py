"""Top-20 #6 phase 7 — AGENT dispatch branch extracted from run_executor.

Owns the ``elif run_task.type == RunTaskType.AGENT`` block of
``execute_chat_run`` — agent_ask flow, agent execution via the registry, and
post-success result wiring (vault_rag follow-up, artifacts/blocks merge,
slide_project capture, planner-driven follow-up task append).
"""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.agent_ask import (
    ASK_DECISION_PROCEED,
    wait_for_agent_ask_decision,
)
from oaao_orchestrator.agent_phase_handoff import (
    emit_inter_agent_ask,
    resolve_agent_ask_prompt,
)
from oaao_orchestrator.agents import get_agent_registry
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.run_executor_plan import append_tasks_to_plan
from oaao_orchestrator.run_executor_vault_rag import apply_vault_rag_agent_result
from oaao_orchestrator.safety.agent_timeout import run_agent_with_timeout
from oaao_orchestrator.tasks.models import RunTaskStatus
from oaao_orchestrator.tasks.stream_emit import (
    emit_run_task_end,
    emit_task_list_status,
)

logger = logging.getLogger(__name__)


async def handle_agent_task(
    *,
    run,
    req,
    plan,
    task_queue,
    run_task,
    run_ctx: RunContext,
    allowed_agents,
    messages_for_llm: list[dict],
    pipeline_snap: dict | None,
    slide_project_meta: dict[str, Any] | None,
) -> tuple[list[dict], dict | None, bool, bool, dict[str, Any] | None, bool]:
    """Execute one AGENT-kind run_task.

    Returns ``(messages_for_llm, pipeline_snap, task_failed, run_failed,
    slide_project_meta, skip_remainder)``. When ``skip_remainder`` is True the
    caller should ``continue`` the per-task loop (ask was cancelled/declined
    and ``emit_run_task_end`` has already been emitted by this helper).
    """

    task_failed = False
    run_failed = False

    needs_ask, ask_msg, ask_meta = resolve_agent_ask_prompt(
        run_task,
        req,
        run_ctx_extra=run_ctx.extra,
    )
    if needs_ask:
        run_task.status = RunTaskStatus.AWAITING_ASK
        await emit_inter_agent_ask(
            run,
            plan,
            run_task,
            message=ask_msg,
            ask_meta=ask_meta,
            allowed_agents=allowed_agents,
            pipeline_snap=pipeline_snap,
        )
        decision = await wait_for_agent_ask_decision(run, run_task_id=run_task.id)
        if run.cancelled or decision != ASK_DECISION_PROCEED:
            run_task.status = RunTaskStatus.SKIPPED
            await emit_run_task_end(
                run,
                plan,
                run_task,
                allowed_agents=allowed_agents,
                pipeline_snap=pipeline_snap,
            )
            return (
                messages_for_llm,
                pipeline_snap,
                task_failed,
                run_failed,
                slide_project_meta,
                True,
            )
        run_task.status = RunTaskStatus.ACTIVE
        await emit_task_list_status(
            run,
            plan,
            allowed_agents=allowed_agents,
            pipeline_snap=pipeline_snap,
            text="agent_ask_proceeded",
        )

    run_ctx.extra["run_plan"] = plan
    run_ctx.extra["pipeline_snap_base"] = (
        dict(pipeline_snap) if isinstance(pipeline_snap, dict) else {}
    )
    agent_result = await run_agent_with_timeout(
        get_agent_registry().run,
        run=run,
        run_task=run_task,
        ctx=run_ctx,
    )
    if not agent_result.success:
        task_failed = True
        run_failed = True
    else:
        kind = (run_task.agent_kind or "").strip()
        if kind == "vault_rag":
            (
                messages_for_llm,
                pipeline_snap,
                vr_failed,
            ) = await apply_vault_rag_agent_result(
                agent_result,
                messages_for_llm=messages_for_llm,
                run_ctx=run_ctx,
                pipeline_snap=pipeline_snap,
            )
            if vr_failed:
                task_failed = True
                run_failed = True
        else:
            messages_for_llm = list(run_ctx.messages)
            run_ctx.messages = list(messages_for_llm)
        if agent_result.artifacts:
            pipeline_snap = pipeline_snap or {}
            arts = pipeline_snap.get("artifacts")
            if not isinstance(arts, list):
                arts = []
            pipeline_snap["artifacts"] = list(arts) + list(agent_result.artifacts)
        extra_blocks = agent_result.extra.get("pipeline_blocks")
        if isinstance(extra_blocks, list) and extra_blocks:
            pipeline_snap = pipeline_snap or {}
            blocks = pipeline_snap.get("blocks")
            if not isinstance(blocks, list):
                blocks = []
            pipeline_snap["blocks"] = list(blocks) + [
                b for b in extra_blocks if isinstance(b, dict)
            ]
            for block in extra_blocks:
                if isinstance(block, dict) and block.get("kind") == "web_search":
                    hits = block.get("hits")
                    if isinstance(hits, list):
                        pipeline_snap["web_search_hits"] = hits
                    break
        sp = agent_result.extra.get("slide_project")
        if isinstance(sp, dict) and sp.get("project_id"):
            slide_project_meta = sp
            run_ctx.extra["slide_project_id"] = str(sp["project_id"])
        extra_append = agent_result.extra.get("append_tasks")
        if isinstance(extra_append, list) and extra_append:
            from oaao_orchestrator.planner_llm import (
                PlannerOutputDraft,
                PlannerTaskDraft,
                planner_output_to_run_plan,
            )

            draft = PlannerOutputDraft(
                tasks=[
                    PlannerTaskDraft.model_validate(x)
                    for x in extra_append
                    if isinstance(x, dict)
                ]
            )
            follow = planner_output_to_run_plan(
                draft,
                allowed_agents=allowed_agents,
                require_vault=False,
                require_attachments=False,
            ).tasks
            append_tasks_to_plan(plan, task_queue, follow)
            await emit_task_list_status(
                run,
                plan,
                allowed_agents=allowed_agents,
                pipeline_snap=pipeline_snap,
                text="tasks_appended",
            )

    return (
        messages_for_llm,
        pipeline_snap,
        task_failed,
        run_failed,
        slide_project_meta,
        False,
    )
