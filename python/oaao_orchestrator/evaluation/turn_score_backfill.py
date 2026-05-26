"""Background re-score of historical assistant turns (missing or stale IQS / ACCS)."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

from oaao_orchestrator.evaluation.scorer_version import (
    needs_accs_rescore,
    needs_iqs_rescore,
)
from oaao_orchestrator.post_stream_persist import upsert_turn_score
from oaao_orchestrator.post_stream_schemas import AccsScoreResult, IqsScoreResult

logger = logging.getLogger(__name__)

_inflight: set[int] = set()
_inflight_lock = asyncio.Lock()
_inflight_meta: dict[int, dict[str, Any]] = {}


@dataclass
class TurnRescoreItem:
    assistant_message_id: int
    turn_index: int
    user_message: str
    assistant_content: str
    conversation_history: list[dict[str, Any]]
    pipeline_snap: dict[str, Any] | None
    stored_version: str
    iqs: float
    accs: float
    iqs_dims: dict[str, float]
    accs_dims: dict[str, float]
    iqs_action: str
    needs_iqs: bool
    needs_accs: bool


def build_turn_rescore_item(
    *,
    assistant_message_id: int,
    turn_index: int,
    user_message: str,
    assistant_content: str,
    conversation_history: list[dict[str, Any]],
    pipeline_snap: dict[str, Any] | None,
    stored_version: str,
    iqs: float,
    accs: float,
    iqs_dims: dict[str, Any] | None,
    accs_dims: dict[str, Any] | None,
    iqs_action: str,
) -> TurnRescoreItem | None:
    iqs_dims_norm = {
        str(k): float(v) for k, v in (iqs_dims or {}).items() if isinstance(v, (int, float))
    }
    accs_dims_norm = {
        str(k): float(v) for k, v in (accs_dims or {}).items() if isinstance(v, (int, float))
    }
    action = (iqs_action or "").strip().lower()
    need_iqs = needs_iqs_rescore(stored_version=stored_version, iqs=iqs, iqs_dims=iqs_dims_norm)
    need_accs = needs_accs_rescore(
        stored_version=stored_version,
        accs=accs,
        accs_dims=accs_dims_norm,
        iqs_action=action,
    )
    if not need_iqs and not need_accs:
        return None
    if not (assistant_content or "").strip():
        return None
    return TurnRescoreItem(
        assistant_message_id=assistant_message_id,
        turn_index=turn_index,
        user_message=user_message,
        assistant_content=assistant_content,
        conversation_history=list(conversation_history),
        pipeline_snap=pipeline_snap,
        stored_version=stored_version,
        iqs=iqs,
        accs=accs,
        iqs_dims=iqs_dims_norm,
        accs_dims=accs_dims_norm,
        iqs_action=action,
        needs_iqs=need_iqs,
        needs_accs=need_accs,
    )


async def rescore_turn_item(
    *,
    conversation_id: int,
    item: TurnRescoreItem,
    coach_endpoint: dict[str, Any] | None = None,
) -> None:
    meta = {
        "conversation_id": conversation_id,
        "assistant_message_id": item.assistant_message_id,
        "turn_index": item.turn_index,
    }
    from oaao_orchestrator.evaluation.accs import score_accs
    from oaao_orchestrator.evaluation.iqs import score_iqs

    iqs_action = item.iqs_action
    if item.needs_iqs:
        iqs_result = await score_iqs(
            user_message=item.user_message,
            conversation_history=item.conversation_history,
            coach_endpoint=coach_endpoint,
        )
        iqs_action = iqs_result.action
        await upsert_turn_score(
            plugin_id="iqs",
            meta=meta,
            score=IqsScoreResult(
                iqs=float(iqs_result.score),
                dimensions=dict(iqs_result.dimensions or {}),
                reasons={"action": iqs_result.action, "source": iqs_result.source},
            ),
        )

    if item.needs_accs and iqs_action not in ("clarify", "hard_clarify"):
        evidence: list[Any] = []
        if item.pipeline_snap and isinstance(item.pipeline_snap.get("vault_rag"), dict):
            raw_ev = item.pipeline_snap["vault_rag"].get("passages") or []
            if isinstance(raw_ev, list):
                evidence = raw_ev
        accs_result = await score_accs(
            user_message=item.user_message,
            llm_output=item.assistant_content,
            evidence=evidence,
            coach_endpoint=coach_endpoint,
        )
        await upsert_turn_score(
            plugin_id="accs",
            meta=meta,
            score=AccsScoreResult(
                accs=float(accs_result.score),
                dimensions=dict(accs_result.factors or {}),
                reasons={"action": accs_result.action, "source": accs_result.source},
            ),
        )


async def _run_conversation_rescore(
    *,
    conversation_id: int,
    turns: list[TurnRescoreItem],
    coach_endpoint: dict[str, Any] | None,
) -> None:
    for item in turns:
        try:
            await rescore_turn_item(
                conversation_id=conversation_id,
                item=item,
                coach_endpoint=coach_endpoint,
            )
        except Exception:
            logger.exception(
                "turn_score rescore failed conversation_id=%s assistant_message_id=%s",
                conversation_id,
                item.assistant_message_id,
            )
        await asyncio.sleep(0.05)
    logger.info(
        "turn_score rescore done conversation_id=%s turns=%s",
        conversation_id,
        len(turns),
    )


async def _run_conversation_rescore_guarded(
    *,
    conversation_id: int,
    turns: list[TurnRescoreItem],
    coach_endpoint: dict[str, Any] | None,
) -> None:
    try:
        await _run_conversation_rescore(
            conversation_id=conversation_id,
            turns=turns,
            coach_endpoint=coach_endpoint,
        )
    finally:
        async with _inflight_lock:
            _inflight.discard(conversation_id)
            _inflight_meta.pop(conversation_id, None)


async def try_schedule_conversation_rescore(
    *,
    conversation_id: int,
    turns: list[TurnRescoreItem],
    coach_endpoint: dict[str, Any] | None = None,
) -> bool:
    """Return False when conversation rescore is already running."""
    if conversation_id < 1 or not turns:
        return False
    async with _inflight_lock:
        if conversation_id in _inflight:
            return False
        _inflight.add(conversation_id)
        _inflight_meta[conversation_id] = {
            "started_at": time.time(),
            "turn_count": len(turns),
        }
    asyncio.create_task(  # noqa: RUF006
        _run_conversation_rescore_guarded(
            conversation_id=conversation_id,
            turns=turns,
            coach_endpoint=coach_endpoint,
        )
    )
    return True
