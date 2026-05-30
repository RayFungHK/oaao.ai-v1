"""Registry-driven post-turn productivity workers — attach after ``system/end`` (IQS/ACCS pattern)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from oaao_orchestrator.streaming.session import StreamRun

logger = logging.getLogger(__name__)

def post_turn_actions_from_request(req: object | None) -> list[dict[str, Any]]:
    raw = getattr(req, "post_turn_actions", None) if req is not None else None
    if not isinstance(raw, list) or not raw:
        logger.warning(
            "post_turn_actions missing or empty on request — no productivity workers scheduled"
        )
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if isinstance(row, dict) and str(row.get("action_id") or "").strip():
            out.append(dict(row))
    if not out:
        logger.warning(
            "post_turn_actions had no valid action_id rows — no productivity workers scheduled"
        )
    return out


def schedule_post_turn_productivity_actions(
    *,
    req: object,
    run: StreamRun,
    metrics_payload: dict[str, Any],
    messages_for_llm: list[dict[str, Any]],
    persist_text: str,
    run_id: str,
) -> None:
    """Fire-and-forget — runs after ``system/end`` so the stream can finish immediately."""
    if getattr(run, "cancelled", False) or not (persist_text or "").strip():
        return
    try:
        cid = int(str(getattr(req, "conversation_id", "") or "0"))
    except (TypeError, ValueError):
        cid = 0
    if cid < 1:
        return

    actions = post_turn_actions_from_request(req)
    if not actions:
        return

    asyncio.create_task(  # noqa: RUF006
        _run_post_turn_productivity_actions(
            req=req,
            run=run,
            metrics_payload=metrics_payload,
            messages_for_llm=messages_for_llm,
            persist_text=persist_text,
            run_id=run_id,
            conversation_id=cid,
            actions=actions,
        )
    )


async def _run_post_turn_productivity_actions(
    *,
    req: object,
    run: StreamRun,
    metrics_payload: dict[str, Any],
    messages_for_llm: list[dict[str, Any]],
    persist_text: str,
    run_id: str,
    conversation_id: int,
    actions: list[dict[str, Any]],
) -> None:
    attached: dict[str, Any] = {}
    enabled_ids = {str(a.get("action_id") or "").strip() for a in actions if isinstance(a, dict)}

    if "calendar_event_suggested" in enabled_ids:
        try:
            from oaao_orchestrator.evaluation.calendar_event_candidate import (
                classify_calendar_event_candidate,
            )
            from oaao_orchestrator.evaluation.calendar_event_suggested_stream import (
                emit_calendar_event_suggested_status,
            )

            row = next(
                (a for a in actions if str(a.get("action_id") or "") == "calendar_event_suggested"),
                {},
            )
            min_conf = float(row.get("min_confidence") or 0.62)
            template_ref = str(row.get("template_ref") or "").strip() or None
            cal_candidate = await classify_calendar_event_candidate(
                conversation_id=conversation_id,
                messages=messages_for_llm,
                assistant_text=persist_text,
                min_confidence=min_conf,
                chat_request=req,
                template_ref=template_ref,
            )
            if cal_candidate is not None:
                payload_cal = cal_candidate.to_dict()
                attached["calendar_event_suggested"] = payload_cal
                metrics_payload["calendar_event_suggested"] = payload_cal
                await emit_calendar_event_suggested_status(run, payload_cal)
        except Exception:
            logger.exception(
                "post_turn calendar_event_suggested failed run_id=%s conversation_id=%s",
                run_id,
                conversation_id,
            )

    if "todo_items_suggested" in enabled_ids or "todo_item_suggested" in enabled_ids:
        try:
            from oaao_orchestrator.evaluation.todo_item_candidate import (
                classify_todo_item_candidates,
            )
            from oaao_orchestrator.evaluation.todo_item_suggested_stream import (
                emit_todo_item_suggested_status,
                emit_todo_items_suggested_status,
            )

            row = next(
                (
                    a
                    for a in actions
                    if str(a.get("action_id") or "")
                    in ("todo_items_suggested", "todo_item_suggested")
                ),
                {},
            )
            min_conf = float(row.get("min_confidence") or 0.58)
            template_ref = str(row.get("template_ref") or "").strip() or None
            open_todos = getattr(req, "open_todo_items", None) or []
            todo_candidates = await classify_todo_item_candidates(
                conversation_id=conversation_id,
                messages=messages_for_llm,
                assistant_text=persist_text,
                min_confidence=min_conf,
                open_todo_items=open_todos if isinstance(open_todos, list) else [],
                chat_request=req,
                template_ref=template_ref,
            )
            if len(todo_candidates) >= 2:
                item_payloads = [c.to_dict() for c in todo_candidates]
                attached["todo_items_suggested"] = item_payloads
                metrics_payload["todo_items_suggested"] = item_payloads
                await emit_todo_items_suggested_status(
                    run,
                    conversation_id=conversation_id,
                    items=item_payloads,
                )
            elif len(todo_candidates) == 1:
                payload_todo = todo_candidates[0].to_dict()
                attached["todo_item_suggested"] = payload_todo
                metrics_payload["todo_item_suggested"] = payload_todo
                await emit_todo_item_suggested_status(run, payload_todo)
        except Exception:
            logger.exception(
                "post_turn todo_items_suggested failed run_id=%s conversation_id=%s",
                run_id,
                conversation_id,
            )

    if "todo_resolve_suggested" in enabled_ids:
        open_todos = getattr(req, "open_todo_items", None) or []
        if open_todos:
            try:
                from oaao_orchestrator.evaluation.todo_completion_checker import (
                    classify_todo_resolve_hint,
                )
                from oaao_orchestrator.evaluation.todo_resolve_suggested_stream import (
                    emit_todo_resolve_suggested_status,
                )

                resolve_hint = classify_todo_resolve_hint(
                    conversation_id=conversation_id,
                    assistant_text=persist_text,
                    open_todos=open_todos if isinstance(open_todos, list) else [],
                )
                if resolve_hint is not None:
                    payload_resolve = resolve_hint.to_dict()
                    attached["todo_resolve_suggested"] = payload_resolve
                    metrics_payload["todo_resolve_suggested"] = payload_resolve
                    await emit_todo_resolve_suggested_status(run, payload_resolve)
            except Exception:
                logger.exception(
                    "post_turn todo_resolve_suggested failed run_id=%s conversation_id=%s",
                    run_id,
                    conversation_id,
                )

    if not attached:
        await _mark_post_turn_productivity_scanned(
            req=req,
            persist_text=persist_text,
            metrics_payload=metrics_payload,
        )
        return

    try:
        uid = int(str(getattr(req, "user_id", "") or "0"))
    except (TypeError, ValueError):
        uid = 0
    try:
        mid = int(str(getattr(req, "assistant_message_id", "") or "0"))
    except (TypeError, ValueError):
        mid = 0

    strip_body: dict[str, Any] = dict(attached)
    if uid > 0 and mid > 0:
        try:
            from oaao_orchestrator.evaluation.strip_items import build_strip_stage_payload

            strip_body = build_strip_stage_payload(
                attached,
                user_id=uid,
                conversation_id=conversation_id,
                message_id=mid,
            )
        except Exception:
            logger.exception(
                "post_turn strip items build failed run_id=%s conversation_id=%s",
                run_id,
                conversation_id,
            )
            strip_body = {"area": "strip", **attached}

    try:
        from oaao_orchestrator.streaming.ui_stage_stream import emit_ui_stage

        await emit_ui_stage(run, "strip", strip_body)
    except Exception:
        logger.exception(
            "post_turn ui_stage strip failed run_id=%s conversation_id=%s",
            run_id,
            conversation_id,
        )

    try:
        from oaao_orchestrator.chat_persist import persist_assistant_message
        from oaao_orchestrator.run_principal import RunPrincipal, verify_token

        principal_raw = getattr(req, "run_principal", None)
        if isinstance(principal_raw, str) and principal_raw.strip():
            from oaao_orchestrator._internal_secret import require_internal_secret

            principal = verify_token(principal_raw, secret=require_internal_secret())
            if isinstance(principal, RunPrincipal):
        persist_assistant_message(
            principal=principal,
            content=persist_text,
            meta={**metrics_payload, **attached, "post_turn_productivity_scanned": True},
            append=bool(getattr(req, "append_assistant_content", False)),
        )
    except Exception:
        logger.exception(
            "post_turn productivity meta attach failed run_id=%s conversation_id=%s",
            run_id,
            conversation_id,
        )

    logger.info(
        "post_turn productivity attached run_id=%s conversation_id=%s keys=%s",
        run_id,
        conversation_id,
        sorted(attached.keys()),
    )


async def _mark_post_turn_productivity_scanned(
    *,
    req: object,
    persist_text: str,
    metrics_payload: dict[str, Any],
) -> None:
    """Persist scan-complete marker so info_worker stops pending [info] pills."""
    try:
        from oaao_orchestrator.chat_persist import persist_assistant_message
        from oaao_orchestrator.run_principal import RunPrincipal, verify_token

        principal_raw = getattr(req, "run_principal", None)
        if not isinstance(principal_raw, str) or not principal_raw.strip():
            return
        from oaao_orchestrator._internal_secret import require_internal_secret

        principal = verify_token(principal_raw, secret=require_internal_secret())
        if not isinstance(principal, RunPrincipal):
            return
        meta = {**metrics_payload, "post_turn_productivity_scanned": True}
        persist_assistant_message(
            principal=principal,
            content=persist_text,
            meta=meta,
            append=bool(getattr(req, "append_assistant_content", False)),
        )
    except Exception:
        logger.exception("post_turn productivity scan marker failed")
