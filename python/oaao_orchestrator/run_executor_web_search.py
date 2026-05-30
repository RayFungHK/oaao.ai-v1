"""Prepare-only public web search — same execution as WebSearchAgent, not type=agent."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def apply_web_search_prepare_result(
    agent_result: Any,
    *,
    messages_for_llm: list[dict[str, Any]],
    run_ctx: Any,
    pipeline_snap: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, bool]:
    if not agent_result.success:
        return messages_for_llm, pipeline_snap, True
    messages_for_llm = list(run_ctx.messages)
    run_ctx.messages = list(messages_for_llm)
    pipeline_snap = pipeline_snap or {}
    if agent_result.artifacts:
        arts = pipeline_snap.get("artifacts")
        if not isinstance(arts, list):
            arts = []
        pipeline_snap["artifacts"] = list(arts) + list(agent_result.artifacts)
    extra_blocks = agent_result.extra.get("pipeline_blocks")
    if isinstance(extra_blocks, list) and extra_blocks:
        blocks = pipeline_snap.get("blocks")
        if not isinstance(blocks, list):
            blocks = []
        pipeline_snap["blocks"] = list(blocks) + [
            b for b in extra_blocks if isinstance(b, dict)
        ]
        for block in extra_blocks:
            if isinstance(block, dict) and block.get("kind") == "web_search":
                hits = block.get("hits")
                if isinstance(hits, list):
                    pipeline_snap["web_search_hits"] = hits
                break
    from oaao_orchestrator.slide_project.rag_context import merge_slide_grounding_into_ctx

    merge_slide_grounding_into_ctx(
        run_ctx,
        pipeline_snap=pipeline_snap if isinstance(pipeline_snap, dict) else None,
    )
    return messages_for_llm, pipeline_snap, False


async def handle_web_search_task(
    *,
    run: Any,
    req: Any,
    run_task: Any,
    plan: Any,
    run_ctx: Any,
    allowed_agents: Any,
    pipeline_snap: dict[str, Any] | None,
    messages_for_llm: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, bool]:
    """Run prepare-only web search (reuses WebSearchAgent implementation)."""
    from oaao_orchestrator.agents import get_agent_registry
    from oaao_orchestrator.safety.agent_timeout import run_agent_with_timeout

    run_ctx.extra["pipeline_snap_base"] = (
        dict(pipeline_snap) if isinstance(pipeline_snap, dict) else {}
    )
    run_ctx.extra["run_plan"] = plan
    failed = False
    try:
        agent_result = await run_agent_with_timeout(
            get_agent_registry().run,
            run=run,
            run_task=run_task,
            ctx=run_ctx,
            agent_kind="web_search",
        )
        (
            messages_for_llm,
            pipeline_snap,
            failed,
        ) = await apply_web_search_prepare_result(
            agent_result,
            messages_for_llm=messages_for_llm,
            run_ctx=run_ctx,
            pipeline_snap=pipeline_snap,
        )
    except Exception:
        logger.exception("web_search_prepare_failed run_task=%s", getattr(run_task, "id", ""))
        failed = True
    return messages_for_llm, pipeline_snap, failed
