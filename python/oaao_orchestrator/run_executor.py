"""
Chat run executor — Run Task checklist + sequential work (Phase 1–2).

Phase 2: LLM planner + one-shot report-result replan after configured tasks.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from oaao_orchestrator.agent_phase_handoff import (
    maybe_inter_agent_handoff,
)
from oaao_orchestrator.agents import get_agent_registry
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.pipeline_ui import (
    build_minimal_pipeline_snapshot,
    merge_vault_chat_sources_into_snapshot,
)
from oaao_orchestrator.planner import build_run_plan, resolve_allowed_agents
from oaao_orchestrator.planner_llm import plan_report_result_tasks, planner_enabled

# W5-S2 phase 2 — pipeline_timing helpers live in run_executor_timing.py.
# Imported as underscore-prefixed names for back-compat with existing call sites.
from oaao_orchestrator.run_executor_timing import (
    elapsed_ms_since as _elapsed_ms_since,
)
from oaao_orchestrator.run_executor_timing import (
    finalize_run_task_timing as _finalize_run_task_timing,
)
from oaao_orchestrator.run_executor_timing import (
    record_pipeline_phase as _record_pipeline_phase,
)

# W5-S2 phase 1 — Upstream sampling + timeout helpers live in
# run_executor_upstream.py. The underscore-prefixed names below are kept as
# thin aliases so internal callers in this module need no churn.
from oaao_orchestrator.safety.agent_timeout import run_agent_with_timeout
from oaao_orchestrator.streaming.events import (
    KIND_STATUS,
    PHASE_LLM,
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
    inject_slide_project_id as _inject_slide_project_id,
)
from oaao_orchestrator.run_executor_plan import (  # noqa: E402
    materials_end_snapshot as _materials_end_snapshot,
)
from oaao_orchestrator.run_executor_plan import (  # noqa: E402
    plan_pipeline_source as _plan_pipeline_source,
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
from oaao_orchestrator.run_executor_plan import (  # noqa: E402
    slide_worker_concurrency as _slide_worker_concurrency,
)
from oaao_orchestrator.run_executor_vault_rag import (  # noqa: E402
    handle_vault_rag_task as _handle_vault_rag_task,
)
from oaao_orchestrator.run_executor_vault_rag import (  # noqa: E402
    vault_rag_ctx_extra as _vault_rag_ctx_extra,
)


async def execute_chat_run(
    *,
    run_id: str,
    req: Any,
    registry: StreamSessionRegistry,
) -> None:
    from oaao_orchestrator.chat_helpers import (
        _chat_completions_url,
        _hook_before_llm,
        _report_usage_to_php,
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
        _hook_before_llm(req)

        from oaao_orchestrator.run_principal import require_for_request

        run_principal = require_for_request(req)

        from oaao_orchestrator.evaluation.coach_client import (
            inline_iqs_clarify_enabled,
        )
        from oaao_orchestrator.evaluation.iqs import (
            score_iqs,
            should_bypass_iqs_clarify,
        )
        from oaao_orchestrator.planner_llm import _last_user_message

        user_msg_for_iqs = _last_user_message(messages_for_llm)
        coach_endpoint = req.uiqe if isinstance(req.uiqe, dict) else None
        clarify_gate = inline_iqs_clarify_enabled()

        async def _timed_iqs():
            t0 = time.perf_counter()
            res = await score_iqs(
                user_message=user_msg_for_iqs,
                conversation_history=messages_for_llm,
                coach_endpoint=coach_endpoint,
                inline=True,
            )
            return res, _elapsed_ms_since(t0)

        async def _timed_plan() -> tuple[RunPlan, int]:
            t0 = time.perf_counter()
            built = await build_run_plan(
                req,
                chat_completions_url=planner_url,
                api_key=planner_api_key,
                model=planner_model,
            )
            return built, _elapsed_ms_since(t0)

        def _record_plan_phase(duration_ms: int, *, source: str | None = None) -> None:
            _record_pipeline_phase(
                pipeline_timing,
                "plan",
                duration_ms,
                model=planner_model if planner_enabled(req) else None,
                source=source or _plan_pipeline_source(req),
            )

        async def _maybe_recall_crystallized_plan(iqs_result: object, current: RunPlan) -> RunPlan:
            from oaao_orchestrator.crystallization.plan import (
                build_plan_from_tool_chain,
            )
            from oaao_orchestrator.crystallization.recall import recall_skill

            if str(getattr(iqs_result, "action", "") or "") not in ("pass", "assume_defaults"):
                return current
            t_recall = time.perf_counter()
            skill_hit = await recall_skill(
                user_msg_for_iqs,
                embedding_cfg=req.embedding if isinstance(req.embedding, dict) else None,
            )
            _record_pipeline_phase(pipeline_timing, "skill_recall", _elapsed_ms_since(t_recall))
            if skill_hit is None:
                return current
            iqs_snap["crystallized_skill_recall"] = {
                "skill_id": skill_hit.skill.id,
                "similarity": round(float(skill_hit.similarity), 4),
                "tool_chain": list(skill_hit.skill.tool_chain),
            }
            _record_plan_phase(0, source="crystallized_skill")
            await run.append(
                StreamEnvelope(
                    phase=PHASE_SYSTEM,
                    kind=KIND_STATUS,
                    text="reusing_crystallized_skill",
                    payload={
                        "skill_id": skill_hit.skill.id,
                        "trigger_intent": skill_hit.skill.trigger_intent,
                        "similarity": round(float(skill_hit.similarity), 4),
                        "tool_chain": list(skill_hit.skill.tool_chain),
                    },
                )
            )
            return build_plan_from_tool_chain(skill_hit.skill.tool_chain)

        if clarify_gate:
            iqs_result, iqs_ms = await _timed_iqs()
            _record_pipeline_phase(pipeline_timing, "iqs", iqs_ms, source=iqs_result.source)
        else:
            await run.append(
                StreamEnvelope(
                    phase=PHASE_SYSTEM,
                    kind=KIND_STATUS,
                    text="plan_build_start",
                    payload={},
                )
            )
            (iqs_result, iqs_ms), (plan, plan_ms) = await asyncio.gather(
                _timed_iqs(), _timed_plan()
            )
            _record_pipeline_phase(pipeline_timing, "iqs", iqs_ms, source=iqs_result.source)
            _record_plan_phase(plan_ms)

        iqs_snap = {
            "iqs_score": round(float(iqs_result.score), 4),
            "iqs_action": iqs_result.action,
            "iqs_dimensions": iqs_result.dimensions,
            "iqs_skipped": bool(iqs_result.skipped),
            "iqs_source": iqs_result.source,
        }

        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind="status",
                text="llm_request_start",
                payload={
                    "purpose_id": req.purpose_id,
                    "chat_profile_id": req.chat_profile.id,
                    **iqs_snap,
                },
            )
        )

        if (
            clarify_gate
            and iqs_result.action in ("clarify", "hard_clarify")
            and not iqs_result.skipped
            and not should_bypass_iqs_clarify(user_msg_for_iqs, messages_for_llm)
            and iqs_result.clarification_questions
        ):
            clarify_lines = list(iqs_result.clarification_questions)
            if len(clarify_lines) == 1:
                clarify_text = clarify_lines[0]
            else:
                clarify_text = "\n\n".join(
                    f"{i}. {q}" for i, q in enumerate(clarify_lines, start=1)
                )
            if clarify_text:
                streamed_parts.append(clarify_text)
                out_chars += len(clarify_text)
            await run.append(
                StreamEnvelope(
                    phase=PHASE_SYSTEM,
                    kind="status",
                    text="iqs_clarify",
                    payload={
                        **iqs_snap,
                        "clarification_questions": clarify_lines,
                    },
                )
            )
            if clarify_text:
                await run.append(
                    StreamEnvelope(
                        phase=PHASE_LLM,
                        kind="delta",
                        text=clarify_text,
                        payload={"iqs_action": iqs_result.action},
                    )
                )
            return

        pipeline_snap = merge_vault_chat_sources_into_snapshot(
            build_minimal_pipeline_snapshot(),
            list(req.vault_source_ids or []),
            [r.model_dump() for r in (req.vault_source_refs or [])],
        )

        if clarify_gate:
            if iqs_result.action in ("pass", "assume_defaults"):
                await run.append(
                    StreamEnvelope(
                        phase=PHASE_SYSTEM,
                        kind=KIND_STATUS,
                        text="plan_build_start",
                        payload={},
                    )
                )
                plan, plan_ms = await _timed_plan()
                _record_plan_phase(plan_ms)
                plan = await _maybe_recall_crystallized_plan(iqs_result, plan)
            else:
                await run.append(
                    StreamEnvelope(
                        phase=PHASE_SYSTEM,
                        kind=KIND_STATUS,
                        text="plan_build_start",
                        payload={},
                    )
                )
                plan, plan_ms = await _timed_plan()
                _record_plan_phase(plan_ms)
        else:
            plan = await _maybe_recall_crystallized_plan(iqs_result, plan)

        from oaao_orchestrator.planner_modes import refine_plan_for_mode

        planner_mode_id = str(getattr(req, "planner_mode_id", None) or "default")
        plan, planner_mode_meta = await refine_plan_for_mode(
            plan,
            req=req,
            mode_id=planner_mode_id,
            chat_completions_url=planner_url,
            api_key=planner_api_key,
            model=planner_model,
            allowed_agents=allowed_agents,
        )
        if planner_mode_meta.get("mode") in ("tot", "ddtree"):
            iqs_snap["planner_mode_meta"] = planner_mode_meta
            await run.append(
                StreamEnvelope(
                    phase=PHASE_SYSTEM,
                    kind=KIND_STATUS,
                    text=f"planner_mode_{planner_mode_meta.get('mode')}",
                    payload=planner_mode_meta,
                )
            )

        task_queue: list[RunTaskSpec] = list(plan.tasks)
        report_after_ids = set(plan.report_after_task_ids)
        report_replan_done = False
        pipeline_timing["thinking_ms"] = _elapsed_ms_since(t_start)

        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind=KIND_STATUS,
                text="preflight_timing",
                payload={"pipeline_timing": dict(pipeline_timing)},
            )
        )

        await emit_task_list_status(
            run, plan, allowed_agents=allowed_agents, pipeline_snap=pipeline_snap, text="task_plan"
        )

        scope_docs: dict[int, list[int]] = {}
        for raw_vid, raw_ids in (req.vault_scope_documents or {}).items():
            try:
                vid = int(raw_vid)
            except (TypeError, ValueError):
                continue
            if vid < 1 or not isinstance(raw_ids, list):
                continue
            clean_ids: list[int] = []
            for x in raw_ids:
                try:
                    did = int(x)
                except (TypeError, ValueError):
                    continue
                if did > 0:
                    clean_ids.append(did)
            if clean_ids:
                scope_docs[vid] = sorted(set(clean_ids))

        slide_designer_cfg = req.slide_designer if isinstance(req.slide_designer, dict) else {}
        if isinstance(getattr(plan, "slide_designer", None), dict):
            slide_designer_cfg = dict(plan.slide_designer)
        if isinstance(slide_designer_cfg, dict) and (
            slide_designer_cfg.get("start_new_deck") or slide_designer_cfg.get("regenerate_deck")
        ):
            slide_designer_cfg = dict(slide_designer_cfg)
            slide_designer_cfg.pop("resume_project_id", None)
            slide_designer_cfg.pop("continuation", None)
        run_ctx_extra: dict[str, Any] = {
            "allowed_agents": allowed_agents,
            "assistant_message_id": req.assistant_message_id,
            "workspace_id": req.workspace_id,
            "planner_mode_id": str(getattr(req, "planner_mode_id", None) or "default"),
            "llm_url": planner_url,
            "llm_api_key": api_key,
            "llm_model": planner_model,
            "slide_designer": slide_designer_cfg,
            "vault_rag": _vault_rag_ctx_extra(
                req,
                scope_docs=scope_docs,
                pipeline_snap=pipeline_snap,
                plan=plan,
            ),
        }
        if run_principal is not None:
            run_ctx_extra["run_principal"] = run_principal
        run_ctx = RunContext(
            conversation_id=req.conversation_id,
            user_id=req.user_id,
            purpose_id=req.purpose_id,
            mode_id=req.mode_id,
            messages=list(messages_for_llm),
            model=req.endpoint.model,
            extra=run_ctx_extra,
        )

        cancel_emitted = False

        while task_queue:
            parallel_batch = _pop_parallel_batch(task_queue)
            if parallel_batch and _slide_page_parallel_batch(parallel_batch):
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
                    async with sem:  # noqa: B023
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
                                pipeline_snap=pipeline_snap,  # noqa: B023
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
                            pipeline_snap=pipeline_snap,  # noqa: B023
                        )
                        failed = False
                        try:
                            run_ctx.extra["run_plan"] = plan
                            run_ctx.extra["pipeline_snap_base"] = (
                                dict(pipeline_snap) if isinstance(pipeline_snap, dict) else {}  # noqa: B023
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
                                pipeline_snap=pipeline_snap,  # noqa: B023
                                failed=failed,
                                duration_ms=page_ms,
                            )
                        return failed

                results = await asyncio.gather(
                    *[_run_slide_page_task(t) for t in parallel_batch],
                    return_exceptions=True,
                )
                for r in results:
                    if isinstance(r, Exception) or r is True:
                        run_failed = True
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
                    cancel_emitted = True
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
        t_end = time.perf_counter()
        duration_ms = int((t_end - t_start) * 1000)
        gen_secs = (
            (t_end - t_first_token) if t_first_token is not None else max(t_end - t_start, 1e-9)
        )
        tokens_out: int | None = completion_tokens
        tokens_estimated = False
        if tokens_out is None and out_chars > 0:
            tokens_out = max(1, int(out_chars / 4))
            tokens_estimated = True
        tps: float | None = None
        if tokens_out is not None and gen_secs > 1e-6:
            tps = round(float(tokens_out) / float(gen_secs), 2)

        metrics_payload: dict[str, Any] = {
            "duration_ms": duration_ms,
            "generation_ms": int(gen_secs * 1000),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "tokens_out": tokens_out,
            "tokens_estimated": tokens_estimated,
            "tokens_per_sec": tps,
            "endpoint_ref": req.endpoint.endpoint_ref,
            "model": req.endpoint.model,
            "chat_profile": req.chat_profile.name,
        }
        endpoint_id = req.endpoint_id or req.endpoint.endpoint_id
        if endpoint_id is not None and int(endpoint_id) > 0:
            metrics_payload["endpoint_id"] = int(endpoint_id)
        if req.chat_endpoint_id is not None and int(req.chat_endpoint_id) > 0:
            metrics_payload["chat_endpoint_id"] = int(req.chat_endpoint_id)
        if req.purpose_key:
            metrics_payload["purpose_key"] = str(req.purpose_key).strip()
        if req.user_id:
            try:
                uid = int(str(req.user_id).strip())
                if uid > 0:
                    metrics_payload["user_id"] = uid
            except (TypeError, ValueError):
                pass
        if plan is not None:
            metrics_payload["tasks"] = plan.task_list_payload(allowed_agents=allowed_agents)
        if pipeline_snap is not None:
            metrics_payload["oaao_pipeline"] = pipeline_snap
        if slide_project_meta is not None:
            metrics_payload["slide_project"] = slide_project_meta
        mats = _materials_end_snapshot(slide_project_meta, pipeline_snap)
        if mats:
            metrics_payload["materials"] = mats
        if finish_reason:
            metrics_payload["finish_reason"] = finish_reason
        if run.cancelled:
            metrics_payload["cancelled"] = True
        if run_failed:
            metrics_payload["run_failed"] = True
        if run_error_detail:
            metrics_payload["run_error"] = run_error_detail

        if iqs_snap is not None:
            metrics_payload.update(iqs_snap)

        if not run.cancelled and not run_failed and streamed_parts:
            try:
                from oaao_orchestrator.evaluation.inline_reflection import (
                    maybe_reflect_and_revise,
                )
                from oaao_orchestrator.planner_llm import _last_user_message

                coach_ep = req.uiqe if isinstance(req.uiqe, dict) else None
                _rev_text, reflection_meta = await maybe_reflect_and_revise(
                    run=run,
                    user_message=_last_user_message(messages_for_llm),
                    assistant_text="".join(streamed_parts),
                    streamed_parts=streamed_parts,
                    messages_for_llm=messages_for_llm,
                    pipeline_snap=pipeline_snap if isinstance(pipeline_snap, dict) else None,
                    coach_endpoint=coach_ep,
                    llm_url=_chat_completions_url(req.endpoint.base_url),
                    api_key=_resolve_api_key(req.endpoint.api_key_env),
                    model=req.endpoint.model,
                )
                if reflection_meta:
                    metrics_payload.update(reflection_meta)
            except Exception:
                logger.exception("inline_reflection_failed run_id=%s", run_id)

        assistant_text = "".join(streamed_parts)
        persist_text = assistant_text.strip()
        if not persist_text and run_principal is not None and not run.cancelled:
            if run_error_detail:
                persist_text = f"Run failed: {run_error_detail}"
            elif run_failed:
                persist_text = (
                    "The assistant run ended without a reply. "
                    "Check the LLM endpoint or Activity log, then retry."
                )
            else:
                persist_text = "No reply text was generated for this turn."

        if not run.cancelled:
            try:
                from oaao_orchestrator.conversation_title import (
                    resolve_conversation_title_for_run,
                )
                from oaao_orchestrator.planner_llm import _last_user_message

                conv_title = await resolve_conversation_title_for_run(
                    req,
                    plan=plan,
                    user_message=_last_user_message(messages_for_llm),
                    assistant_snippet=assistant_text,
                    chat_completions_url=_chat_completions_url(req.endpoint.base_url),
                    api_key=_resolve_api_key(req.endpoint.api_key_env),
                    model=req.endpoint.model,
                )
                if conv_title:
                    metrics_payload["conversation_title"] = conv_title
            except Exception:
                logger.exception("conversation_title resolve failed run_id=%s", run_id)

        metrics_payload["pipeline_timing"] = pipeline_timing
        metrics_payload["run_status"] = "complete"

        end_text = "run_cancelled" if run.cancelled else "run_closed"
        await run.append(
            StreamEnvelope(
                phase=PHASE_SYSTEM,
                kind="end",
                text=end_text,
                payload=metrics_payload,
            )
        )
        run.mark_done()

        async def _post_run_end_housekeeping() -> None:
            try:
                if run_principal is not None and persist_text:
                    from oaao_orchestrator.chat_persist import (
                        persist_assistant_message,
                    )

                    if persist_assistant_message(
                        principal=run_principal,
                        content=persist_text,
                        meta=metrics_payload,
                    ):
                        metrics_payload["persisted_by_orchestrator"] = True
                if run_principal is not None and (
                    metrics_payload.get("conversation_title")
                    or metrics_payload.get("slide_project")
                    or metrics_payload.get("materials")
                ):
                    from oaao_orchestrator._internal_secret import (
                        require_internal_secret,
                    )
                    from oaao_orchestrator.chat_internal_sync import (
                        sync_adjunct_via_php,
                    )

                    secret = require_internal_secret()
                    await sync_adjunct_via_php(
                        principal=run_principal,
                        meta=metrics_payload,
                        shared_secret=secret,
                    )
                if not run.cancelled:
                    from oaao_orchestrator.evaluation.post_stream_worker import (
                        evolution_post_stream_enabled,
                        schedule_evolution_post_stream,
                    )
                    from oaao_orchestrator.post_stream_pool import (
                        enqueue_post_stream_jobs_for_chat,
                    )

                    schedule_evolution_post_stream(
                        req=req,
                        metrics_payload=metrics_payload,
                        assistant_text=assistant_text,
                        messages_for_llm=messages_for_llm,
                        pipeline_snap=pipeline_snap,
                        coach_endpoint=coach_endpoint,
                        iqs_snap=iqs_snap,
                        plan=plan,
                        run_id=run_id,
                        run_failed=run_failed,
                    )
                    if not evolution_post_stream_enabled():
                        await enqueue_post_stream_jobs_for_chat(
                            req=req, metrics_payload=metrics_payload
                        )
                await _report_usage_to_php(
                    tenant_id=req.tenant_id,
                    event_kind="chat.completion",
                    meta=metrics_payload,
                )
            except Exception:
                logger.exception("post_run_end_housekeeping failed run_id=%s", run_id)

        asyncio.create_task(_post_run_end_housekeeping())  # noqa: RUF006
