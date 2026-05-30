"""Top-20 #6 phase 16 — run-task dispatch switch extracted.

The big ``if/elif`` chain inside :func:`execute_chat_run`'s dispatch try-block
folds into :func:`dispatch_run_task` here. The helper owns the per-type
routing for VAULT_RAG / ATTACHMENTS / AGENT / LLM_CALL / LLM_STREAM / EMIT
plus the unsupported-type fallback, and bundles all mutable state the caller
needs to read back into a :class:`DispatchOutcome` record.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal

from oaao_orchestrator.run_executor_agent import handle_agent_task
from oaao_orchestrator.run_executor_attachments import handle_attachments_task
from oaao_orchestrator.run_executor_llm_stream import (
    LLMStreamState,
    handle_llm_stream_task,
)
from oaao_orchestrator.run_executor_vault_rag import handle_vault_rag_task
from oaao_orchestrator.run_executor_web_search import handle_web_search_task
from oaao_orchestrator.streaming.events import PHASE_SYSTEM, StreamEnvelope
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskStatus, RunTaskType
from oaao_orchestrator.tasks.stream_emit import emit_run_task_end

logger = logging.getLogger(__name__)

DispatchControl = Literal["fallthrough", "continue", "return"]


@dataclass
class DispatchOutcome:
    """Mutable state the caller must propagate after dispatch returns."""

    messages_for_llm: list[Any]
    pipeline_snap: dict[str, Any] | None
    task_failed: bool
    run_failed: bool
    slide_project_meta: dict[str, Any] | None
    t_first_token: float | None
    out_chars: int
    completion_tokens: int | None
    prompt_tokens: int | None
    finish_reason: str | None
    control: DispatchControl


async def dispatch_run_task(
    *,
    run: Any,
    req: Any,
    run_task: RunTaskSpec,
    plan: RunPlan,
    task_queue: list[RunTaskSpec],
    run_ctx: Any,
    allowed_agents: Any,
    scope_docs: dict[int, list[int]],
    messages_for_llm: list[Any],
    pipeline_snap: dict[str, Any] | None,
    pipeline_timing: dict[str, Any],
    slide_project_meta: dict[str, Any] | None,
    streamed_parts: list[str],
    t_first_token: float | None,
    out_chars: int,
    completion_tokens: int | None,
    prompt_tokens: int | None,
    finish_reason: str | None,
    task_failed: bool,
    run_failed: bool,
    api_key: str | None,
    task_t0: float,
) -> DispatchOutcome:
    """Dispatch one task to its per-type handler and return the new state."""
    control: DispatchControl = "fallthrough"

    if run_task.type == RunTaskType.VAULT_RAG:
        messages_for_llm, pipeline_snap = await handle_vault_rag_task(
            req=req,
            run=run,
            run_task=run_task,
            plan=plan,
            run_ctx=run_ctx,
            allowed_agents=allowed_agents,
            scope_docs=scope_docs,
            pipeline_snap=pipeline_snap,
            messages_for_llm=messages_for_llm,
        )

    elif run_task.type == RunTaskType.ATTACHMENTS:
        messages_for_llm, pipeline_snap = await handle_attachments_task(
            req=req,
            run_ctx=run_ctx,
            messages_for_llm=messages_for_llm,
            pipeline_snap=pipeline_snap,
        )

    elif run_task.type == RunTaskType.WEB_SEARCH:
        messages_for_llm, pipeline_snap, ws_failed = await handle_web_search_task(
            req=req,
            run=run,
            run_task=run_task,
            plan=plan,
            run_ctx=run_ctx,
            allowed_agents=allowed_agents,
            pipeline_snap=pipeline_snap,
            messages_for_llm=messages_for_llm,
        )
        if ws_failed:
            task_failed = True
            run_failed = True

    elif run_task.type == RunTaskType.AGENT:
        (
            messages_for_llm,
            pipeline_snap,
            task_failed,
            run_failed,
            slide_project_meta,
            agent_skip,
        ) = await handle_agent_task(
            run=run,
            req=req,
            plan=plan,
            task_queue=task_queue,
            run_task=run_task,
            run_ctx=run_ctx,
            allowed_agents=allowed_agents,
            messages_for_llm=messages_for_llm,
            pipeline_snap=pipeline_snap,
            slide_project_meta=slide_project_meta,
        )
        if agent_skip:
            control = "continue"

    elif run_task.type == RunTaskType.LLM_CALL:
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind="status",
                text="llm_call_skipped",
                payload={"run_task_id": run_task.id},
            )
        )

    elif run_task.type == RunTaskType.LLM_STREAM:
        stream_state = LLMStreamState(
            streamed_parts=streamed_parts,
            t_first_token=t_first_token,
            out_chars=out_chars,
            completion_tokens=completion_tokens,
            prompt_tokens=prompt_tokens,
            finish_reason=finish_reason,
            task_failed=task_failed,
            run_failed=run_failed,
        )
        llm_abort = await handle_llm_stream_task(
            state=stream_state,
            run=run,
            req=req,
            run_ctx=run_ctx,
            run_task=run_task,
            plan=plan,
            allowed_agents=allowed_agents,
            messages_for_llm=messages_for_llm,
            pipeline_snap=pipeline_snap,
            pipeline_timing=pipeline_timing,
            task_t0=task_t0,
            api_key=api_key,
        )
        t_first_token = stream_state.t_first_token
        out_chars = stream_state.out_chars
        completion_tokens = stream_state.completion_tokens
        prompt_tokens = stream_state.prompt_tokens
        finish_reason = stream_state.finish_reason
        task_failed = stream_state.task_failed
        run_failed = stream_state.run_failed
        if llm_abort:
            control = "return"

    elif run_task.type == RunTaskType.EMIT:
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind="status",
                text=run_task.title or "emit",
                payload={"run_task_id": run_task.id},
            )
        )

    else:
        logger.warning("unsupported run_task type=%s id=%s", run_task.type, run_task.id)
        run_task.status = RunTaskStatus.SKIPPED
        await emit_run_task_end(
            run,
            plan,
            run_task,
            allowed_agents=allowed_agents,
            pipeline_snap=pipeline_snap,
        )
        control = "continue"

    return DispatchOutcome(
        messages_for_llm=messages_for_llm,
        pipeline_snap=pipeline_snap,
        task_failed=task_failed,
        run_failed=run_failed,
        slide_project_meta=slide_project_meta,
        t_first_token=t_first_token,
        out_chars=out_chars,
        completion_tokens=completion_tokens,
        prompt_tokens=prompt_tokens,
        finish_reason=finish_reason,
        control=control,
    )
