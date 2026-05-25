"""
Inline reflection — ACCS-triggered Main re-generate before ship (Evolution §6).

Runs synchronously in ``run_executor`` after the task loop, before ``system/end``.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from oaao_orchestrator.evaluation.accs import ACCSResult, score_accs
from oaao_orchestrator.evaluation.reflection import run_reflection_loop
from oaao_orchestrator.streaming.events import PHASE_LLM, PHASE_SYSTEM, StreamEnvelope
from oaao_orchestrator.streaming.session import StreamRun

logger = logging.getLogger(__name__)


def inline_reflection_enabled() -> bool:
    if os.environ.get("OAAO_REFLECTION_DISABLE", "").strip().lower() in ("1", "true", "yes"):
        return False
    return os.environ.get("OAAO_INLINE_REFLECTION", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _evidence_from_pipeline(pipeline_snap: dict[str, Any] | None) -> list[Any]:
    if not isinstance(pipeline_snap, dict):
        return []
    vr = pipeline_snap.get("vault_rag")
    if isinstance(vr, dict):
        raw = vr.get("passages") or []
        return list(raw) if isinstance(raw, list) else []
    return []


async def maybe_reflect_and_revise(
    *,
    run: StreamRun,
    user_message: str,
    assistant_text: str,
    streamed_parts: list[str],
    messages_for_llm: list[dict[str, Any]],
    pipeline_snap: dict[str, Any] | None,
    coach_endpoint: dict[str, Any] | None,
    llm_url: str,
    api_key: str | None,
    model: str,
) -> tuple[str, dict[str, Any]]:
    """
    Score ACCS; when action is ``reflect``, re-generate once and replace streamed output.

    Returns ``(final_text, reflection_meta)`` for metrics envelope.
    """
    meta: dict[str, Any] = {}
    if not inline_reflection_enabled():
        meta["reflection_skipped"] = True
        return assistant_text, meta
    if not (assistant_text or "").strip() or not (user_message or "").strip():
        return assistant_text, meta

    evidence = _evidence_from_pipeline(pipeline_snap)
    initial = await score_accs(
        user_message=user_message,
        llm_output=assistant_text,
        evidence=evidence,
        coach_endpoint=coach_endpoint,
    )
    meta["accs_score"] = round(float(initial.score), 4)
    meta["accs_action"] = initial.action
    if initial.skipped:
        meta["accs_skipped"] = True
        return assistant_text, meta
    if initial.action != "reflect":
        if initial.degraded:
            meta["degraded"] = True
        if initial.crystallization_candidate:
            meta["crystallization_candidate"] = True
        return assistant_text, meta

    from oaao_orchestrator.planner_llm import llm_chat_completion_text  # noqa: PLC0415

    async def _regenerate(critique: str, accs_result: ACCSResult) -> str | None:
        reflection_messages = list(messages_for_llm) + [
            {"role": "assistant", "content": assistant_text},
            {"role": "user", "content": critique},
        ]
        return await llm_chat_completion_text(
            url=llm_url,
            api_key=api_key,
            model=model,
            messages=reflection_messages,
            temperature=0.3,
            timeout_s=120.0,
        )

    rounds = await run_reflection_loop(
        user_message=user_message,
        first_output=assistant_text,
        evidence=evidence,
        coach_endpoint=coach_endpoint,
        initial_accs=initial,
        regenerate=_regenerate,
    )
    if not rounds:
        meta["reflection_skipped"] = True
        return assistant_text, meta

    rd = rounds[0]
    revised = str(rd.get("output") or "").strip()
    if not revised:
        return assistant_text, meta

    meta["reflection_triggered"] = True
    meta["reflection_round"] = 1
    meta["reflection_initial_score"] = rd.get("initial_score")
    meta["reflection_final_score"] = rd.get("final_score")
    if rd.get("degraded"):
        meta["degraded"] = True
    rescored = rd.get("reflection_rescored")
    if isinstance(rescored, dict) and rescored.get("score", 0) >= 0.85:
        meta["crystallization_candidate"] = True

    await run.append(
        StreamEnvelope(
            phase=PHASE_SYSTEM,
            kind="status",
            text="reflection_complete",
            payload=dict(meta),
        )
    )
    await run.append(
        StreamEnvelope(
            phase=PHASE_LLM,
            kind="delta",
            text=revised,
            payload={"reflection_round": 1, "replace_prior": True},
        )
    )
    streamed_parts.clear()
    streamed_parts.append(revised)
    return revised, meta
