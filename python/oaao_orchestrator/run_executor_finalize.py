"""Top-20 #6 phase 9 — execute_chat_run ``finally`` finalisation extracted.

Owns metrics_payload assembly, run_end envelope emission, ``run.mark_done()``
call, and the ``_post_run_end_housekeeping`` background task (persistence,
adjunct sync, post-stream worker scheduling, PHP usage report).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from oaao_orchestrator.streaming.events import PHASE_SYSTEM, StreamEnvelope

logger = logging.getLogger(__name__)


async def finalize_run(
    *,
    run,
    run_id: str,
    req,
    t_start: float,
    t_first_token: float | None,
    out_chars: int,
    completion_tokens: int | None,
    prompt_tokens: int | None,
    finish_reason: str | None,
    streamed_parts: list[str],
    messages_for_llm: list[dict],
    plan,
    allowed_agents,
    pipeline_snap: dict[str, Any] | None,
    pipeline_timing: dict[str, Any],
    slide_project_meta: dict[str, Any] | None,
    iqs_snap: dict[str, Any] | None,
    coach_endpoint: dict[str, Any] | None,
    run_principal,
    run_failed: bool,
    run_error_detail: str | None,
) -> None:
    """Finalise a chat run: build metrics, emit ``run_end``, schedule housekeeping."""

    from oaao_orchestrator.chat_helpers import (
        _chat_completions_url,
        _report_usage_to_php,
    )
    from oaao_orchestrator.endpoint_keys import resolve_api_key as _resolve_api_key
    from oaao_orchestrator.bubble_chat_run import should_skip_bubble_ephemeral_hooks
    from oaao_orchestrator.run_executor_plan import (
        materials_end_snapshot as _materials_end_snapshot,
    )

    skip_ephemeral_hooks = should_skip_bubble_ephemeral_hooks(req)

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

    # ACCS coach review + optional rewrite run in post_stream_worker (non-blocking).
    # Critique is injected on the *next* user turn via PHP accs_reflection_context.
    metrics_payload["inline_reflection_deferred"] = True

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
            from oaao_orchestrator.run_executor_plan import slide_deck_persist_summary

            slide_summary = slide_deck_persist_summary(slide_project_meta)
            persist_text = slide_summary or "No reply text was generated for this turn."

    if not run.cancelled and persist_text:
        try:
            cid_skill = int(str(req.conversation_id or "0"))
        except (TypeError, ValueError):
            cid_skill = 0
        if cid_skill > 0 and not skip_ephemeral_hooks:
            try:
                from oaao_orchestrator.evaluation.skill_candidate import (
                    classify_skill_candidate,
                )
                from oaao_orchestrator.evaluation.skill_suggested_stream import (
                    emit_skill_suggested_status,
                )

                candidate = classify_skill_candidate(
                    conversation_id=cid_skill,
                    messages=messages_for_llm,
                    assistant_text=persist_text,
                )
                if candidate is not None:
                    payload_skill = candidate.to_dict()
                    metrics_payload["skill_suggested"] = payload_skill
                    await emit_skill_suggested_status(run, payload_skill)
            except Exception:
                logger.exception("skill_suggested_emit_failed run_id=%s", run_id)

        applied_ids: list[str] = []
        from oaao_orchestrator.tasks.models import RunPlan as _RunPlan

        if isinstance(plan, _RunPlan) and plan.apply_skill_ids:
            applied_ids = list(plan.apply_skill_ids)
        if (
            not skip_ephemeral_hooks
            and not run.cancelled
            and not run_failed
            and persist_text
            and applied_ids
            and run_principal is not None
        ):
            try:
                from oaao_orchestrator._internal_secret import require_internal_secret
                from oaao_orchestrator.evaluation.skill_upgrade import pick_skill_upgrade_candidate
                from oaao_orchestrator.evaluation.skill_upgrade_stream import (
                    emit_skill_upgrade_suggested_status,
                )
                from oaao_orchestrator.micro_skills.usage_sync import record_skill_usage_via_php

                secret = require_internal_secret()
                skill_rows = await record_skill_usage_via_php(
                    principal=run_principal,
                    skill_ids=applied_ids,
                    shared_secret=secret,
                )
                if skill_rows:
                    metrics_payload["skill_usage"] = skill_rows
                    accs_hint = metrics_payload.get("accs_score")
                    accs_val = float(accs_hint) if isinstance(accs_hint, (int, float)) else None
                    upgrade = pick_skill_upgrade_candidate(
                        conversation_id=cid_skill,
                        skill_rows=skill_rows,
                        accs_score=accs_val,
                    )
                    if upgrade is not None:
                        payload_up = upgrade.to_dict()
                        metrics_payload["skill_upgrade_suggested"] = payload_up
                        await emit_skill_upgrade_suggested_status(run, payload_up)
            except Exception:
                logger.exception("skill_usage_record_failed run_id=%s", run_id)

    if not run.cancelled and not skip_ephemeral_hooks:
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
                api_key=_resolve_api_key(req.endpoint),
                model=req.endpoint.model,
            )
            if conv_title:
                metrics_payload["conversation_title"] = conv_title
        except Exception:
            logger.exception("conversation_title resolve failed run_id=%s", run_id)

    metrics_payload["pipeline_timing"] = pipeline_timing
    metrics_payload["run_status"] = "complete"

    if not run.cancelled:
        try:
            from oaao_orchestrator.streaming.ui_stage_stream import emit_ui_stage

            state_payload = {
                k: metrics_payload[k]
                for k in (
                    "duration_ms",
                    "generation_ms",
                    "tokens_per_sec",
                    "tokens_estimated",
                    "pipeline_timing",
                    "prompt_tokens",
                    "completion_tokens",
                    "tokens_out",
                )
                if k in metrics_payload
            }
            if state_payload:
                await emit_ui_stage(run, "state", state_payload)
        except Exception:
            logger.exception("ui_stage state emit failed run_id=%s", run_id)

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
                from oaao_orchestrator.chat_persist import persist_assistant_message

                if persist_assistant_message(
                    principal=run_principal,
                    content=persist_text,
                    meta=metrics_payload,
                    append=bool(getattr(req, "append_assistant_content", False)),
                ):
                    metrics_payload["persisted_by_orchestrator"] = True
            if run_principal is not None and (
                metrics_payload.get("conversation_title")
                or metrics_payload.get("slide_project")
                or metrics_payload.get("materials")
                or (
                    isinstance(metrics_payload.get("oaao_pipeline"), dict)
                    and isinstance(metrics_payload["oaao_pipeline"].get("artifacts"), list)
                    and metrics_payload["oaao_pipeline"]["artifacts"]
                )
            ):
                from oaao_orchestrator._internal_secret import require_internal_secret
                from oaao_orchestrator.chat_internal_sync import sync_adjunct_via_php

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
                    run=run,
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
                from oaao_orchestrator.knowledge.orientation_worker import (
                    schedule_orientation_update,
                )

                schedule_orientation_update(
                    req=req,
                    messages=list(messages_for_llm or []),
                    metrics_payload=metrics_payload,
                )
                if not evolution_post_stream_enabled():
                    await enqueue_post_stream_jobs_for_chat(
                        req=req, metrics_payload=metrics_payload
                    )
                from oaao_orchestrator.evaluation.post_turn_action_worker import (
                    schedule_post_turn_productivity_actions,
                )

                schedule_post_turn_productivity_actions(
                    req=req,
                    run=run,
                    metrics_payload=metrics_payload,
                    messages_for_llm=messages_for_llm,
                    persist_text=persist_text,
                    run_id=run_id,
                )
            await _report_usage_to_php(
                tenant_id=req.tenant_id,
                event_kind="chat.completion",
                meta=metrics_payload,
            )
        except Exception:
            logger.exception("post_run_end_housekeeping failed run_id=%s", run_id)

    asyncio.create_task(_post_run_end_housekeeping())  # noqa: RUF006
