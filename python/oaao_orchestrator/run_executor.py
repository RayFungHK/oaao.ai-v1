"""
Chat run executor — Run Task checklist + sequential work (Phase 1–2).

Phase 2: LLM planner + one-shot report-result replan after configured tasks.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from oaao_orchestrator.agent_phase_handoff import (
    maybe_inter_agent_handoff,
)
from oaao_orchestrator.planner import resolve_allowed_agents
from oaao_orchestrator.planner_llm import plan_report_result_tasks, planner_enabled

# W5-S2 phase 2 — pipeline_timing helpers live in run_executor_timing.py.
# Imported as underscore-prefixed names for back-compat with existing call sites.
from oaao_orchestrator.run_executor_timing import (
    finalize_run_task_timing as _finalize_run_task_timing,
)

# W5-S2 phase 1 — Upstream sampling + timeout helpers live in
# run_executor_upstream.py. The underscore-prefixed names below are kept as
# thin aliases so internal callers in this module need no churn.
from oaao_orchestrator.streaming.events import (
    PHASE_SYSTEM,
    StreamEnvelope,
)
from oaao_orchestrator.streaming.session import StreamSessionRegistry
from oaao_orchestrator.tasks.cancel import emit_run_cancelled
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskStatus, RunTaskType
from oaao_orchestrator.tasks.stream_emit import (
    emit_run_task_end,
    emit_run_task_start,
    emit_task_list_status,
    ensure_run_task_agent_kind,
)

logger = logging.getLogger(__name__)


# Vault-RAG helpers extracted into run_executor_vault_rag (Top-20 #6 phase 3).
# Plan/queue helpers extracted into run_executor_plan (Top-20 #6 phase 4).
# Aliased to underscore names so existing call sites in execute_chat_run need
# no churn.
from oaao_orchestrator.run_executor_agent import (  # noqa: E402
    handle_agent_task as _handle_agent_task,
)
from oaao_orchestrator.run_executor_attachments import (  # noqa: E402
    handle_attachments_task as _handle_attachments_task,
)
from oaao_orchestrator.run_executor_finalize import (  # noqa: E402
    finalize_run as _finalize_run,
)
from oaao_orchestrator.run_executor_llm_stream import (  # noqa: E402
    LLMStreamState as _LLMStreamState,
)
from oaao_orchestrator.run_executor_llm_stream import (  # noqa: E402
    handle_llm_stream_task as _handle_llm_stream_task,
)
from oaao_orchestrator.run_executor_plan import (  # noqa: E402
    append_tasks_to_plan as _append_tasks_to_plan,
)
from oaao_orchestrator.run_executor_plan import (  # noqa: E402
    pop_parallel_batch as _pop_parallel_batch,
)
from oaao_orchestrator.run_executor_plan import (  # noqa: E402
    reindex_plan as _reindex_plan,
)
from oaao_orchestrator.run_executor_plan import (  # noqa: E402
    slide_page_parallel_batch as _slide_page_parallel_batch,
)
from oaao_orchestrator.run_executor_preamble import (  # noqa: E402
    prepare_run_preamble as _prepare_run_preamble,
)
from oaao_orchestrator.run_executor_slide_fanout import (  # noqa: E402
    handle_slide_page_batch as _handle_slide_page_batch,
)
from oaao_orchestrator.run_executor_vault_rag import (  # noqa: E402
    handle_vault_rag_task as _handle_vault_rag_task,
)


async def execute_chat_run(
    *,
    run_id: str,
    req: Any,
    registry: StreamSessionRegistry,
) -> None:
    from oaao_orchestrator.chat_helpers import (
        _chat_completions_url,
        _resolve_planner_llm,
        _sanitize_client_text,
    )
    from oaao_orchestrator.chat_models import ChatRunRequest
    from oaao_orchestrator.endpoint_keys import resolve_api_key as _resolve_api_key

    if not isinstance(req, ChatRunRequest):
        raise TypeError("req must be ChatRunRequest")

    _atts_in = list(getattr(req, "chat_attachments", None) or [])
    logger.info(
        "chat_attachments: execute_chat_run entry run_id=%s count=%s ids=%s",
        run_id,
        len(_atts_in),
        [a.get("id") if isinstance(a, dict) else None for a in _atts_in[:8]],
    )

    from oaao_orchestrator.tools.registry import (
        ToolServerSpec,
        register_tool_server,
    )

    for row in getattr(req, "tool_servers", None) or []:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("id") or "").strip()
        base = str(row.get("base_url") or "").strip()
        if sid and base:
            purposes = row.get("allowed_purposes")
            allowed = [str(p) for p in purposes] if isinstance(purposes, list) else ["chat"]
            spec = row.get("openapi_spec")
            register_tool_server(
                ToolServerSpec(
                    id=sid,
                    base_url=base.rstrip("/"),
                    openapi_url=str(row.get("openapi_url") or "/openapi.json"),
                    allowed_purposes=allowed,
                    openapi_spec=spec if isinstance(spec, dict) else None,
                )
            )

    run = registry.get(run_id)
    if run is None:
        return

    t_start = time.perf_counter()
    t_first_token: float | None = None
    out_chars = 0
    streamed_parts: list[str] = []
    run_principal = None
    completion_tokens: int | None = None
    prompt_tokens: int | None = None
    finish_reason: str | None = None
    pipeline_snap: dict[str, Any] | None = None
    plan: RunPlan | None = None
    messages_for_llm = list(req.messages)
    material_grounding = list(
        getattr(req, "conversation_material_grounding", None) or [],
    )
    reuse_grounding_msg = getattr(req, "reuse_grounding_message_id", None)
    reuse_grounding_turn = False
    try:
        reuse_grounding_turn = int(reuse_grounding_msg or 0) > 0
    except (TypeError, ValueError):
        reuse_grounding_turn = False
    sd_for_reuse = req.slide_designer if isinstance(req.slide_designer, dict) else {}
    if isinstance(sd_for_reuse, dict) and (
        sd_for_reuse.get("regenerate_deck")
        or sd_for_reuse.get("continuation")
        or str(sd_for_reuse.get("active_material_id") or "").strip()
    ):
        reuse_grounding_turn = True
    if material_grounding:
        from oaao_orchestrator.material_grounding import (
            apply_conversation_material_grounding,
        )

        apply_conversation_material_grounding(
            messages_for_llm,
            material_grounding,
            reuse_turn=reuse_grounding_turn,
        )
    run_failed = False
    run_error_detail: str | None = None
    slide_project_meta: dict[str, Any] | None = None
    iqs_snap: dict[str, Any] | None = None
    coach_endpoint: dict[str, Any] | None = None
    pipeline_timing: dict[str, Any] = {"phases": [], "tasks": []}

    planner_url, planner_api_key, planner_model = _resolve_planner_llm(req)
    api_key = _resolve_api_key(req.endpoint)
    allowed_agents = resolve_allowed_agents(req)

    try:
        preamble = await _prepare_run_preamble(
            run=run,
            req=req,
            t_start=t_start,
            messages_for_llm=messages_for_llm,
            pipeline_timing=pipeline_timing,
            streamed_parts=streamed_parts,
            planner_url=planner_url,
            planner_api_key=planner_api_key,
            planner_model=planner_model,
            api_key=api_key,
            allowed_agents=allowed_agents,
        )
        out_chars += preamble.out_chars_delta
        run_principal = preamble.run_principal
        coach_endpoint = preamble.coach_endpoint
        iqs_snap = preamble.iqs_snap
        if preamble.short_circuit:
            return
        pipeline_snap = preamble.pipeline_snap
        plan = preamble.plan
        run_ctx = preamble.run_ctx
        task_queue: list[RunTaskSpec] = preamble.task_queue
        report_after_ids = preamble.report_after_ids
        scope_docs = preamble.scope_docs
        report_replan_done = False

        cancel_emitted = False

        while task_queue:
            parallel_batch = _pop_parallel_batch(task_queue)
            if parallel_batch and _slide_page_parallel_batch(parallel_batch):
                sf_failed, cancel_emitted, sf_control = await _handle_slide_page_batch(
                    parallel_batch=parallel_batch,
                    run=run,
                    run_ctx=run_ctx,
                    plan=plan,
                    allowed_agents=allowed_agents,
                    pipeline_snap=pipeline_snap,
                    pipeline_timing=pipeline_timing,
                    task_queue=task_queue,
                    cancel_emitted=cancel_emitted,
                )
                if sf_failed:
                    run_failed = True
                if sf_control == "break":
                    break
                continue

            if len(parallel_batch) == 1:
                task_queue.insert(0, parallel_batch[0])
            elif len(parallel_batch) > 1:
                for t in reversed(parallel_batch):
                    task_queue.insert(0, t)

            run_task = task_queue.pop(0)
            if run.cancelled:
                run_failed = True
                run_task.status = RunTaskStatus.SKIPPED
                if not cancel_emitted:
                    await emit_run_cancelled(
                        run,
                        plan,
                        pipeline_snap=pipeline_snap,
                        pending_queue=task_queue,
                    )
                    cancel_emitted = True
                break

            ensure_run_task_agent_kind(run_task)
            run_task.status = RunTaskStatus.ACTIVE
            _reindex_plan(plan)
            await emit_run_task_start(
                run, plan, run_task, allowed_agents=allowed_agents, pipeline_snap=pipeline_snap
            )

            task_t0 = time.perf_counter()
            task_failed = False
            try:
                if run_task.type == RunTaskType.VAULT_RAG:
                    messages_for_llm, pipeline_snap = await _handle_vault_rag_task(
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
                    messages_for_llm, pipeline_snap = await _handle_attachments_task(
                        req=req,
                        run_ctx=run_ctx,
                        messages_for_llm=messages_for_llm,
                        pipeline_snap=pipeline_snap,
                    )

                elif run_task.type == RunTaskType.AGENT:
                    (
                        messages_for_llm,
                        pipeline_snap,
                        task_failed,
                        run_failed,
                        slide_project_meta,
                        _agent_skip,
                    ) = await _handle_agent_task(
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
                    if _agent_skip:
                        continue

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
                    _stream_state = _LLMStreamState(
                        streamed_parts=streamed_parts,
                        t_first_token=t_first_token,
                        out_chars=out_chars,
                        completion_tokens=completion_tokens,
                        prompt_tokens=prompt_tokens,
                        finish_reason=finish_reason,
                        task_failed=task_failed,
                        run_failed=run_failed,
                    )
                    _llm_abort = await _handle_llm_stream_task(
                        state=_stream_state,
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
                    t_first_token = _stream_state.t_first_token
                    out_chars = _stream_state.out_chars
                    completion_tokens = _stream_state.completion_tokens
                    prompt_tokens = _stream_state.prompt_tokens
                    finish_reason = _stream_state.finish_reason
                    task_failed = _stream_state.task_failed
                    run_failed = _stream_state.run_failed
                    if _llm_abort:
                        return

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
                    continue

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
                    break

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

            except Exception:
                run_task.status = RunTaskStatus.FAILED
                run_failed = True
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
                    failed=True,
                    duration_ms=task_duration_ms,
                )
                raise

    except Exception as e:
        run_failed = True
        run_error_detail = _sanitize_client_text(str(e))
        req_url = _chat_completions_url(req.endpoint.base_url)
        err_code = (
            "iqs_failed"
            if "iqs" in type(e).__name__.lower() or "Breaker" in type(e).__name__
            else "llm_stream_failed"
        )
        logger.exception(
            "chat_run_failed run_id=%s ref=%s url=%s code=%s",
            run_id,
            req.endpoint.endpoint_ref,
            req_url,
            err_code,
        )
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind="error",
                text=err_code,
                payload={
                    "detail": run_error_detail,
                    "exc_type": type(e).__name__,
                    "hint": "From inside Docker use this compose stack's service hostname + container port for the LLM (e.g. http://my-llm:1234/v1/...); avoid http://127.0.0.1 unless the model shares that container's namespace. Only when the inference server runs on the workstation use http://host.docker.internal:<host-port>.",
                },
            )
        )
    finally:
        await _finalize_run(
            run=run,
            run_id=run_id,
            req=req,
            t_start=t_start,
            t_first_token=t_first_token,
            out_chars=out_chars,
            completion_tokens=completion_tokens,
            prompt_tokens=prompt_tokens,
            finish_reason=finish_reason,
            streamed_parts=streamed_parts,
            messages_for_llm=messages_for_llm,
            plan=plan,
            allowed_agents=allowed_agents,
            pipeline_snap=pipeline_snap,
            pipeline_timing=pipeline_timing,
            slide_project_meta=slide_project_meta,
            iqs_snap=iqs_snap,
            coach_endpoint=coach_endpoint,
            run_principal=run_principal,
            run_failed=run_failed,
            run_error_detail=run_error_detail,
        )
