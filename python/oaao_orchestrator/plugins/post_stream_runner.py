"""Shared post-stream plugin execution — UIQE LLM + JSON parse."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from oaao_orchestrator.plugins.spec import PluginContext
from oaao_orchestrator.post_stream_llm import call_uiqe_chat, uiqe_endpoint_ready
from oaao_orchestrator.post_stream_persist import upsert_turn_score
from oaao_orchestrator.post_stream_schemas import parse_plugin_score

logger = logging.getLogger(__name__)


async def run_scoring_plugin(
    plugin_id: str,
    ctx: PluginContext,
    *,
    prompt_rendered: str,
    endpoint_snapshot: dict[str, Any],
) -> None:
    if not uiqe_endpoint_ready(endpoint_snapshot):
        logger.warning(
            "%s skipped — uiqe endpoint unresolved pool=%s conversation_id=%s",
            plugin_id,
            ctx.pool_id,
            (ctx.meta or {}).get("conversation_id"),
        )
        return

    async with httpx.AsyncClient() as client:
        parsed, err = await call_uiqe_chat(
            client,
            endpoint_snapshot=endpoint_snapshot,
            prompt_rendered=prompt_rendered,
        )
    if err or not parsed:
        logger.warning(
            "%s llm failed pool=%s conversation_id=%s err=%s",
            plugin_id,
            ctx.pool_id,
            (ctx.meta or {}).get("conversation_id"),
            err,
        )
        return

    score = parse_plugin_score(plugin_id, parsed)
    if score is None:
        logger.warning(
            "%s invalid score JSON pool=%s conversation_id=%s keys=%s",
            plugin_id,
            ctx.pool_id,
            (ctx.meta or {}).get("conversation_id"),
            list(parsed.keys()),
        )
        return

    meta = ctx.meta if isinstance(ctx.meta, dict) else {}
    logger.info(
        "%s scored pool=%s conversation_id=%s assistant_message_id=%s result=%s",
        plugin_id,
        ctx.pool_id,
        meta.get("conversation_id"),
        meta.get("assistant_message_id"),
        score.model_dump(),
    )
    await upsert_turn_score(plugin_id=plugin_id, meta=meta, score=score)
