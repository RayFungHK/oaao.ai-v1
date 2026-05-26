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
    from oaao_orchestrator.run_executor_plan import (
        materials_end_snapshot as _materials_end_snapshot,
    )

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

            try:
                cid = int(str(req.conversation_id or "0"))
            except (TypeError, ValueError):
                cid = 0
            accs_hint = reflection_meta.get("accs_score") if isinstance(reflection_meta, dict) else None
            if cid > 0 and isinstance(accs_hint, (int, float)) and 0 < float(accs_hint) < 0.65:
                from oaao_orchestrator.evaluation.thread_health_stream import (
                    emit_conversation_health_status,
                    provisional_health_from_accs,
                )
                from oaao_orchestrator.planner_llm import _last_user_message

                health = provisional_health_from_accs(
                    conversation_id=cid,
                    accs_score=float(accs_hint),
                    user_message=_last_user_message(messages_for_llm),
                )
                if health is not None:
                    metrics_payload["thread_health"] = health.to_dict()
                    await emit_conversation_health_status(run, health)
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
                from oaao_orchestrator.chat_persist import persist_assistant_message

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
