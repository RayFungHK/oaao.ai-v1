"""Top-20 #6 phase 6 — chat-attachments dispatch branch extracted from
``run_executor.execute_chat_run``.

The inline branch handled four concerns inline:
1. Run the attachment-processing pipeline (transcription / polish / glossary).
2. Dispose attachments through PHP after they're consumed.
3. Mirror the resulting messages onto ``run_ctx``.
4. Merge milestone+blocks from the attach pipeline into ``pipeline_snap``.

Folding it into ``handle_attachments_task`` keeps the dispatch tree in
``execute_chat_run`` flat and lets us unit-test the merge logic in isolation.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx

from oaao_orchestrator.chat_attachments import process_chat_attachments
from oaao_orchestrator.chat_attachments_dispose import dispose_chat_attachments

logger = logging.getLogger(__name__)

if TYPE_CHECKING:  # pragma: no cover
    from oaao_orchestrator.runtime import RunContext


async def handle_attachments_task(
    *,
    req: Any,
    run_ctx: RunContext,
    messages_for_llm: list[dict[str, Any]],
    pipeline_snap: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Run the ATTACHMENTS dispatch branch.

    Returns the (possibly-updated) ``(messages_for_llm, pipeline_snap)`` tuple.
    Mutates ``run_ctx.messages`` in place so downstream branches see the
    transcribed/polished content.
    """
    attach_pipeline: dict[str, Any] = {}
    attachment_snapshot: list[dict[str, Any]] = []
    for att in req.chat_attachments or []:
        if not isinstance(att, dict):
            continue
        path = str(att.get("absolute_path") or att.get("path") or "").strip()
        if not path:
            continue
        attachment_snapshot.append(
            {
                "id": att.get("id"),
                "absolute_path": path,
                "path": path,
                "mime_type": str(att.get("mime_type") or att.get("mime") or ""),
                "file_name": str(att.get("file_name") or att.get("name") or ""),
            }
        )
    if attachment_snapshot:
        run_ctx.extra["chat_attachment_snapshot"] = attachment_snapshot
    logger.info(
        "chat_attachments: ATTACHMENTS task running count=%s",
        len(req.chat_attachments or []),
    )
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(180.0, connect=15.0)
    ) as att_client:
        messages_for_llm, attach_pipeline = await process_chat_attachments(
            att_client,
            messages_for_llm,
            list(req.chat_attachments or []),
            endpoint=req.endpoint.model_dump(),
            asr_cfg=req.asr if isinstance(req.asr, dict) else None,
            polish_cfg=req.polish if isinstance(req.polish, dict) else None,
            glossary=req.glossary if isinstance(req.glossary, dict) else None,
            mm_understand=req.mm_understand if isinstance(getattr(req, "mm_understand", None), dict) else None,
        )
        att_ids: list[int] = []
        for att in req.chat_attachments or []:
            if not isinstance(att, dict):
                continue
            raw_id = att.get("id")
            try:
                aid = int(raw_id) if raw_id is not None else 0
            except (TypeError, ValueError):
                aid = 0
            if aid > 0:
                att_ids.append(aid)
        if att_ids:
            try:
                cid = int(req.conversation_id or 0)
            except (TypeError, ValueError):
                cid = 0
            try:
                uid = int(req.user_id or 0)
            except (TypeError, ValueError):
                uid = 0
            if cid > 0 and uid > 0:
                from oaao_orchestrator._internal_secret import (
                    require_internal_secret,
                )

                secret = require_internal_secret()
                await dispose_chat_attachments(
                    att_client,
                    conversation_id=cid,
                    user_id=uid,
                    attachment_ids=att_ids,
                    shared_secret=secret,
                )
    run_ctx.messages = list(messages_for_llm)
    if attach_pipeline:
        ms = attach_pipeline.get("milestone")
        if isinstance(ms, dict) and isinstance(ms.get("steps"), list):
            base_ms = (
                pipeline_snap.get("milestone")
                if isinstance(pipeline_snap.get("milestone"), dict)
                else {}
            )
            base_steps = (
                base_ms.get("steps")
                if isinstance(base_ms.get("steps"), list)
                else []
            )
            pipeline_snap = pipeline_snap or {}
            pipeline_snap["milestone"] = {
                "steps": list(ms.get("steps") or []) + list(base_steps),
            }
        ab = attach_pipeline.get("blocks")
        if isinstance(ab, list) and ab:
            pipeline_snap = pipeline_snap or {}
            pipeline_snap["blocks"] = list(ab) + list(
                pipeline_snap.get("blocks") or []
            )
    return messages_for_llm, pipeline_snap
