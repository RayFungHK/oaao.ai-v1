"""WS-1-S2 — orientation worker (tenant / platform global, not per-workspace)."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import httpx

from oaao_orchestrator.corpus.llm import _extract_json_object, chat_completion_text
from oaao_orchestrator.knowledge.orientation_models import (
    OrientationJsonV1,
    OrientationUpdateResult,
)
from oaao_orchestrator.knowledge.orientation_store import (
    load_effective_orientation,
    load_orientation_scoped,
    merge_orientation,
    save_orientation,
)
from oaao_orchestrator.knowledge.scope import (
    KnowledgeScopeRef,
    scope_ref_from_request,
)

logger = logging.getLogger(__name__)

_ORIENTATION_SYSTEM = """You maintain the PLATFORM knowledge orientation for oaao.ai self-evolution (not per-user personalization).
The snapshot aggregates conversation topics, entities, and keywords across tenants — workspace ids are attribution only.
Return ONLY one JSON object matching this schema:
{
  "topics": ["short topic phrases"],
  "entities": ["organizations, products, regulations, …"],
  "language": "BCP47 tag e.g. zh-Hant or en",
  "recency_days": 7-90,
  "search_queries_suggested": ["concrete web search queries, max 8"],
  "do_not_search": ["topics user opted out or compliance blocks"],
  "summary": "2-4 sentences on what this organization cares about for capability evolution"
}
Merge with the prior snapshot; drop stale topics; do not invent facts not supported by the transcript."""


def orientation_enabled() -> bool:
    return os.environ.get("OAAO_KNOWLEDGE_ORIENTATION_ENABLED", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _resolve_orientation_llm_cfg(req: Any, payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if isinstance(payload, dict):
        raw = payload.get("llm_cfg") or payload.get("knowledge_orientation")
        if isinstance(raw, dict) and raw.get("base_url") and raw.get("model"):
            return raw
    knowledge = getattr(req, "knowledge", None)
    if isinstance(knowledge, dict):
        for key in ("orientation", "knowledge.orientation"):
            raw = knowledge.get(key)
            if isinstance(raw, dict) and raw.get("base_url") and raw.get("model"):
                return raw
    return None


def _format_transcript(messages: list[dict[str, Any]], *, max_turns: int = 12) -> str:
    lines: list[str] = []
    for msg in (messages or [])[-max_turns:]:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        content = msg.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        lines.append(f"{role}: {content.strip()[:1200]}")
    return "\n\n".join(lines)


def _parse_orientation_patch(
    raw: dict[str, Any],
    *,
    scope_ref: KnowledgeScopeRef,
    conversation_id: str | None,
) -> OrientationJsonV1:
    return OrientationJsonV1(
        scope=scope_ref.scope,
        tenant_id=scope_ref.tenant_id,
        workspace_id=scope_ref.workspace_id,
        conversation_id=conversation_id,
        topics=[str(x).strip() for x in (raw.get("topics") or []) if str(x).strip()][:24],
        entities=[str(x).strip() for x in (raw.get("entities") or []) if str(x).strip()][:32],
        language=str(raw.get("language") or "zh-Hant").strip()[:32] or "zh-Hant",
        recency_days=(
            max(1, min(365, int(raw["recency_days"])))
            if isinstance(raw.get("recency_days"), (int, float))
            else 30
        ),
        search_queries_suggested=[
            str(x).strip()
            for x in (raw.get("search_queries_suggested") or [])
            if str(x).strip()
        ][:12],
        do_not_search=[
            str(x).strip() for x in (raw.get("do_not_search") or []) if str(x).strip()
        ][:24],
        summary=str(raw.get("summary") or "").strip()[:2000],
    )


async def update_orientation_from_messages(
    *,
    scope_ref: KnowledgeScopeRef,
    messages: list[dict[str, Any]],
    conversation_id: str | None = None,
    llm_cfg: dict[str, Any] | None = None,
    corpus_style: dict[str, Any] | None = None,
) -> OrientationUpdateResult | None:
    prior = load_orientation_scoped(scope_ref)
    transcript = _format_transcript(messages)
    if not transcript.strip():
        return None

    user_parts = [f"scope={scope_ref.scope}"]
    if scope_ref.tenant_id:
        user_parts.append(f"tenant_id={scope_ref.tenant_id}")
    if scope_ref.workspace_id:
        user_parts.append(f"contributing_workspace_id={scope_ref.workspace_id}")
    if conversation_id:
        user_parts.append(f"conversation_id={conversation_id}")
    effective = load_effective_orientation(
        tenant_id=scope_ref.tenant_id,
        workspace_id=scope_ref.workspace_id,
    )
    if effective is not None and effective != prior:
        user_parts.append(
            "effective_orientation_json:\n" + json.dumps(effective.model_dump(), ensure_ascii=False)
        )
    if prior is not None:
        user_parts.append("prior_orientation_json:\n" + json.dumps(prior.model_dump(), ensure_ascii=False))
    if isinstance(corpus_style, dict) and corpus_style:
        user_parts.append(
            "corpus_style_hint:\n"
            + json.dumps(
                {
                    "name": corpus_style.get("name"),
                    "description": corpus_style.get("description"),
                },
                ensure_ascii=False,
            )
        )
    user_parts.append("recent_transcript:\n" + transcript)
    user_blob = "\n\n".join(user_parts)

    patch: OrientationJsonV1 | None = None
    method = "noop"
    if llm_cfg:
        async with httpx.AsyncClient() as client:
            raw_text = await chat_completion_text(
                client,
                llm_cfg=llm_cfg,
                system=_ORIENTATION_SYSTEM,
                user=user_blob,
                temperature=0.2,
                timeout_sec=60.0,
            )
        parsed = _extract_json_object(raw_text or "")
        if isinstance(parsed, dict):
            patch = _parse_orientation_patch(
                parsed,
                scope_ref=scope_ref,
                conversation_id=conversation_id,
            )
            method = "llm"

    if patch is None:
        return None

    merged = merge_orientation(prior, patch)
    save_orientation(merged)
    effective_after = load_effective_orientation(
        tenant_id=scope_ref.tenant_id,
        workspace_id=scope_ref.workspace_id,
    )
    return OrientationUpdateResult(
        ok=True,
        scope=scope_ref.scope,
        tenant_id=scope_ref.tenant_id,
        workspace_id=scope_ref.workspace_id,
        orientation=merged,
        effective_orientation=effective_after,
        method=method,
    )


def schedule_orientation_update(
    *,
    req: Any,
    messages: list[dict[str, Any]],
    metrics_payload: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """Fire-and-forget after ``system/end`` — writes platform evolution orientation (scope=platform)."""
    _ = metrics_payload
    if not orientation_enabled():
        return
    scope_ref = scope_ref_from_request(req)
    if scope_ref is None:
        logger.debug("orientation_update skipped — no tenant_id and platform disabled")
        return

    conversation_id = getattr(req, "conversation_id", None)
    llm_cfg = _resolve_orientation_llm_cfg(req, payload)
    corpus_style = getattr(req, "corpus_style", None)

    async def _run() -> None:
        try:
            await update_orientation_from_messages(
                scope_ref=scope_ref,
                messages=list(messages or []),
                conversation_id=str(conversation_id).strip() if conversation_id else None,
                llm_cfg=llm_cfg,
                corpus_style=corpus_style if isinstance(corpus_style, dict) else None,
            )
        except Exception:
            logger.exception(
                "orientation_update failed scope=%s tenant_id=%s",
                scope_ref.scope,
                scope_ref.tenant_id,
            )

    asyncio.create_task(_run())  # noqa: RUF006
