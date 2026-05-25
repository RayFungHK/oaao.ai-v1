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
    asyncio.create_task(
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
        from oaao_orchestrator.evaluation.coach_client import coach_endpoint_ready  # noqa: PLC0415
        from oaao_orchestrator.evaluation.iqs import score_iqs  # noqa: PLC0415
        from oaao_orchestrator.planner_llm import _last_user_message  # noqa: PLC0415

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

        from oaao_orchestrator.evaluation.accs import score_accs  # noqa: PLC0415

        evidence: list[Any] = []
        if pipeline_snap and isinstance(pipeline_snap.get("vault_rag"), dict):
            raw_ev = pipeline_snap["vault_rag"].get("passages") or []
            if isinstance(raw_ev, list):
                evidence = raw_ev

        accs_result = await score_accs(
            user_message=user_msg,
            llm_output=assistant_text,
            evidence=evidence,
            coach_endpoint=coach_endpoint,
        )
        if accs_result.skipped or accs_result.score <= 0:
            from oaao_orchestrator.evaluation.accs import _score_accs_heuristic  # noqa: PLC0415

            accs_result = await _score_accs_heuristic(
                user_message=user_msg,
                llm_output=assistant_text,
                evidence=evidence,
            )
            accs_result.source = "heuristic_post_stream_fallback"

        if accs_result.score > 0:
            await upsert_turn_score(
                plugin_id="accs",
                meta=meta,
                score=AccsScoreResult(
                    accs=float(accs_result.score),
                    dimensions=dict(accs_result.factors or {}),
                    reasons={"action": accs_result.action, "source": accs_result.source},
                ),
            )

        if (
            accs_result.crystallization_candidate
            and not accs_result.degraded
            and not accs_result.skipped
        ):
            from oaao_orchestrator.crystallization.sealer import try_seal_skill  # noqa: PLC0415

            await try_seal_skill(
                run_id=run_id,
                accs_score=float(accs_result.score),
                tool_chain=_tool_chain_from_plan(plan),
                planner_output={"tasks": [t.id for t in plan.tasks]} if plan else {},
                final_answer=assistant_text,
                user_message=user_msg,
                flags={
                    "degraded": bool(accs_result.degraded),
                    "iqs_skipped": bool(iqs_snap and iqs_snap.get("iqs_skipped")),
                    "accs_skipped": bool(accs_result.skipped),
                },
                embedding_cfg=getattr(req, "embedding", None) if isinstance(getattr(req, "embedding", None), dict) else None,
            )

        logger.info(
            "evolution post_stream done conversation_id=%s assistant_message_id=%s iqs_persisted=%s accs=%.3f",
            meta.get("conversation_id"),
            meta.get("assistant_message_id"),
            iqs_persisted,
            accs_result.score,
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
