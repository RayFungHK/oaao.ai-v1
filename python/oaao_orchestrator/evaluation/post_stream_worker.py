"""Background post-stream evolution jobs — persist IQS + score ACCS without blocking ``system/end``."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from oaao_orchestrator.post_stream_persist import upsert_turn_score
from oaao_orchestrator.post_stream_pool import build_post_stream_plugin_ctx_meta
from oaao_orchestrator.post_stream_schemas import AccsScoreResult, IqsScoreResult
from oaao_orchestrator.tasks.models import RunPlan, RunTaskType

logger = logging.getLogger(__name__)


def _tool_chain_from_plan(plan: RunPlan | None) -> list[str]:
    if plan is None:
        return []
    chain: list[str] = []
    for task in plan.tasks:
        if task.type == RunTaskType.VAULT_RAG:
            chain.append("vault_rag")
        elif task.type == RunTaskType.LLM_STREAM:
            chain.append("llm_stream")
        elif task.type == RunTaskType.AGENT:
            kind = (task.agent_kind or "").strip()
            if kind:
                chain.append(kind)
    return chain


def evolution_post_stream_enabled() -> bool:
    return os.environ.get("OAAO_EVOLUTION_POST_STREAM", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def schedule_evolution_post_stream(
    *,
    req: Any,
    metrics_payload: dict[str, Any],
    assistant_text: str,
    messages_for_llm: list[Any],
    pipeline_snap: dict[str, Any] | None,
    coach_endpoint: dict[str, Any] | None,
    iqs_snap: dict[str, Any] | None,
    plan: RunPlan | None,
    run_id: str,
    run_failed: bool,
) -> None:
    """Fire-and-forget — runs after ``system/end`` so the chat stream can finish immediately."""
    if not evolution_post_stream_enabled():
        return
    if getattr(req, "cancelled", False):
        return
    asyncio.create_task(  # noqa: RUF006
        _run_evolution_post_stream(
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
    )


async def _run_evolution_post_stream(
    *,
    req: Any,
    metrics_payload: dict[str, Any],
    assistant_text: str,
    messages_for_llm: list[Any],
    pipeline_snap: dict[str, Any] | None,
    coach_endpoint: dict[str, Any] | None,
    iqs_snap: dict[str, Any] | None,
    plan: RunPlan | None,
    run_id: str,
    run_failed: bool,
) -> None:
    meta = build_post_stream_plugin_ctx_meta(req, metrics_payload)
    try:
        from oaao_orchestrator.evaluation.coach_client import coach_endpoint_ready
        from oaao_orchestrator.evaluation.iqs import score_iqs
        from oaao_orchestrator.planner_llm import _last_user_message

        user_msg = _last_user_message(messages_for_llm)
        if (
            coach_endpoint_ready(coach_endpoint)
            and user_msg
            and (not iqs_snap or iqs_snap.get("iqs_source") != "coach")
        ):
            try:
                coach_iqs = await score_iqs(
                    user_message=user_msg,
                    conversation_history=messages_for_llm,
                    coach_endpoint=coach_endpoint,
                    inline=False,
                )
                if not coach_iqs.skipped and coach_iqs.score > 0:
                    iqs_snap = {
                        "iqs_score": round(float(coach_iqs.score), 4),
                        "iqs_action": coach_iqs.action,
                        "iqs_dimensions": coach_iqs.dimensions,
                        "iqs_skipped": False,
                        "iqs_source": coach_iqs.source,
                    }
            except Exception:
                logger.exception(
                    "post-stream IQS coach failed conversation_id=%s",
                    meta.get("conversation_id"),
                )

        iqs_persisted = await _persist_iqs_snap(iqs_snap, meta)
        if not iqs_persisted and user_msg:
            try:
                iqs_result = await score_iqs(
                    user_message=user_msg,
                    conversation_history=messages_for_llm,
                    coach_endpoint=coach_endpoint,
                    inline=False,
                )
                if not iqs_result.skipped and iqs_result.score > 0:
                    await upsert_turn_score(
                        plugin_id="iqs",
                        meta=meta,
                        score=IqsScoreResult(
                            iqs=float(iqs_result.score),
                            dimensions=dict(iqs_result.dimensions or {}),
                            reasons={
                                "action": iqs_result.action,
                                "source": iqs_result.source,
                            },
                        ),
                    )
                    iqs_snap = {
                        "iqs_score": round(float(iqs_result.score), 4),
                        "iqs_action": iqs_result.action,
                        "iqs_dimensions": iqs_result.dimensions,
                        "iqs_skipped": False,
                        "iqs_source": iqs_result.source,
                    }
                    iqs_persisted = True
            except Exception:
                logger.exception(
                    "post-stream IQS heuristic failed conversation_id=%s",
                    meta.get("conversation_id"),
                )

        if run_failed or not (assistant_text or "").strip():
            return
        if iqs_snap and iqs_snap.get("iqs_action") in ("clarify", "hard_clarify"):
            return

        from oaao_orchestrator.evaluation.accs import score_accs
        from oaao_orchestrator.evaluation.pipeline_evidence import (
            evidence_from_pipeline_snap,
            vault_grounding_context_text,
        )

        from oaao_orchestrator.knowledge.promotion import (
            coach_endpoint_from_request,
            resolve_user_id,
            schedule_web_knowledge_promotion,
            web_knowledge_asset_id_from_pipeline,
            web_search_evidence_from_pipeline,
        )

        snap = pipeline_snap if isinstance(pipeline_snap, dict) else None
        evidence = evidence_from_pipeline_snap(snap)
        web_ev = web_search_evidence_from_pipeline(snap)
        if web_ev:
            evidence = list(evidence) + web_ev
        grounding_context = vault_grounding_context_text(snap)
        if web_ev:
            grounding_context = (
                f"{grounding_context}\n\nWeb search snippets: {len(web_ev)} source(s)."
            )

        accs_result = await score_accs(
            user_message=user_msg,
            llm_output=assistant_text,
            evidence=evidence,
            coach_endpoint=coach_endpoint,
            grounding_context=grounding_context,
        )
        if accs_result.skipped or accs_result.score <= 0:
            from oaao_orchestrator.evaluation.accs import _score_accs_heuristic

            accs_result = await _score_accs_heuristic(
                user_message=user_msg,
                llm_output=assistant_text,
                evidence=evidence,
            )
            accs_result.source = "heuristic_post_stream_fallback"

        from oaao_orchestrator.evaluation.conversation_health import (
            is_user_correction,
            topic_shift_flag,
        )

        user_correction = 1 if is_user_correction(user_msg or "") else 0
        ts = topic_shift_flag(
            user_message=user_msg or "",
            accs_factors=dict(accs_result.factors or {}),
            accs_score=float(accs_result.score),
        )
        if accs_result.score > 0:
            accs_reasons: dict[str, Any] = {
                "action": accs_result.action,
                "source": accs_result.source,
                "user_correction": user_correction,
            }
            from oaao_orchestrator.evaluation.deferred_reflection import (
                build_deferred_reflection_reasons,
                deferred_reflection_enabled,
            )

            if accs_result.action == "reflect" and deferred_reflection_enabled():
                accs_reasons.update(build_deferred_reflection_reasons(accs_result))
                logger.info(
                    "accs_reflection_deferred conversation_id=%s assistant_message_id=%s score=%.3f",
                    meta.get("conversation_id"),
                    meta.get("assistant_message_id"),
                    accs_result.score,
                )
            await upsert_turn_score(
                plugin_id="accs",
                meta=meta,
                score=AccsScoreResult(
                    accs=float(accs_result.score),
                    dimensions=dict(accs_result.factors or {}),
                    reasons=accs_reasons,
                ),
                topic_shift=ts,
            )

        if (
            accs_result.crystallization_candidate
            and not accs_result.degraded
            and not accs_result.skipped
        ):
            from oaao_orchestrator.crystallization.sealer import try_seal_skill

            await try_seal_skill(
                run_id=run_id,
                accs_score=float(accs_result.score),
                tool_chain=_tool_chain_from_plan(plan),
                planner_output={"tasks": [t.id for t in plan.tasks]} if plan else {},
                final_answer=assistant_text,
                user_message=user_msg,
                plan_tasks=list(plan.tasks) if plan else None,
                flags={
                    "degraded": bool(accs_result.degraded),
                    "iqs_skipped": bool(iqs_snap and iqs_snap.get("iqs_skipped")),
                    "accs_skipped": bool(accs_result.skipped),
                },
                embedding_cfg=getattr(req, "embedding", None)
                if isinstance(getattr(req, "embedding", None), dict)
                else None,
            )

        logger.info(
            "evolution post_stream done conversation_id=%s assistant_message_id=%s iqs_persisted=%s accs=%.3f topic_shift=%s",
            meta.get("conversation_id"),
            meta.get("assistant_message_id"),
            iqs_persisted,
            accs_result.score,
            ts,
        )
        from oaao_orchestrator.evaluation.evolution_store import (
            record_evolution_run,
            record_low_score_case,
        )

        iqs_score = float(iqs_snap.get("iqs_score") or 0) if isinstance(iqs_snap, dict) else 0.0
        await record_evolution_run(
            {
                "run_id": run_id,
                "conversation_id": meta.get("conversation_id"),
                "iqs_score": iqs_score,
                "iqs_action": iqs_snap.get("iqs_action") if isinstance(iqs_snap, dict) else None,
                "accs_score": float(accs_result.score),
                "purpose_id": meta.get("purpose_id"),
                "tool_chain": _tool_chain_from_plan(plan),
            }
        )
        if iqs_score and iqs_score < 0.5:
            await record_low_score_case(
                {
                    "run_id": run_id,
                    "kind": "iqs",
                    "iqs_score": iqs_score,
                    "iqs_action": iqs_snap.get("iqs_action")
                    if isinstance(iqs_snap, dict)
                    else None,
                    "tool_chain": _tool_chain_from_plan(plan),
                }
            )
        if accs_result.score < 0.65:
            await record_low_score_case(
                {
                    "run_id": run_id,
                    "kind": "accs",
                    "accs_score": float(accs_result.score),
                    "tool_chain": _tool_chain_from_plan(plan),
                }
            )

        asset_id = web_knowledge_asset_id_from_pipeline(snap)
        if asset_id:
            knowledge = getattr(req, "knowledge", None)
            schedule_web_knowledge_promotion(
                asset_id=asset_id,
                user_id=resolve_user_id(req),
                knowledge=knowledge if isinstance(knowledge, dict) else None,
                coach_endpoint=coach_endpoint_from_request(req) or coach_endpoint,
                workspace_id=getattr(req, "workspace_id", None),
                assistant_text=assistant_text,
            )
    except Exception:
        logger.exception(
            "evolution post_stream failed conversation_id=%s assistant_message_id=%s",
            meta.get("conversation_id"),
            meta.get("assistant_message_id"),
        )


async def _persist_iqs_snap(iqs_snap: dict[str, Any] | None, meta: dict[str, Any]) -> bool:
    if not iqs_snap or iqs_snap.get("iqs_skipped"):
        return False
    score_raw = iqs_snap.get("iqs_score")
    if score_raw is None or float(score_raw) <= 0:
        return False
    dims = iqs_snap.get("iqs_dimensions")
    if not isinstance(dims, dict):
        dims = {}
    ok = await upsert_turn_score(
        plugin_id="iqs",
        meta=meta,
        score=IqsScoreResult(
            iqs=float(score_raw),
            dimensions={str(k): float(v) for k, v in dims.items() if isinstance(v, (int, float))},
            reasons={
                "action": str(iqs_snap.get("iqs_action") or ""),
                "source": str(iqs_snap.get("iqs_source") or ""),
            },
        ),
    )
    return bool(ok)
