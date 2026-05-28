"""Web search agent — WS-1-S3 plan + WS-1-S4 asset persist skeleton."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.knowledge.asset_store import persist_web_search_capture
from oaao_orchestrator.knowledge.promotion import (
    coach_endpoint_from_request,
    resolve_user_id,
    schedule_web_knowledge_promotion,
)
from oaao_orchestrator.knowledge.scope import scope_ref_from_request
from oaao_orchestrator.knowledge.search_plan import build_search_plan, execute_search_plan
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.events import PHASE_WEB
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.agent_emit import emit_agent_end, emit_agent_start, run_agent_task_step
from oaao_orchestrator.tasks.models import (
    AgentResult,
    AgentSpec,
    AgentStatus,
    AgentTaskSpec,
    RunPlan,
    RunTaskSpec,
)
from oaao_orchestrator.vault_graph_rag import inject_system_message

logger = logging.getLogger(__name__)


def _chat_request(ctx: RunContext) -> Any:
    return ctx.extra.get("chat_request")


class WebSearchAgent:
    agent_kind = "web_search"

    async def run(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
    ) -> AgentResult:
        req = _chat_request(ctx)
        knowledge = getattr(req, "knowledge", None) if req is not None else None
        if not isinstance(knowledge, dict):
            knowledge = (
                ctx.extra.get("knowledge") if isinstance(ctx.extra.get("knowledge"), dict) else None
            )

        workspace_id = getattr(req, "workspace_id", None) if req is not None else None
        tenant_id = getattr(req, "tenant_id", None) if req is not None else None
        conversation_id = getattr(req, "conversation_id", None) if req is not None else None

        plan_raw = ctx.extra.get("run_plan")
        plan = plan_raw if isinstance(plan_raw, RunPlan) else RunPlan()
        pipeline_base = ctx.extra.get("pipeline_snap_base")
        pipeline_snap: dict[str, Any] = (
            dict(pipeline_base) if isinstance(pipeline_base, dict) else {}
        )

        agent = AgentSpec(
            id=f"ag-{run_task.id}",
            run_task_id=run_task.id,
            kind=self.agent_kind,
            status=AgentStatus.RUNNING,
        )
        await emit_agent_start(
            run,
            phase=PHASE_WEB,
            plan=plan,
            run_task=run_task,
            agent=agent,
            pipeline_snap=pipeline_snap or None,
        )

        search_plan: dict[str, Any] = {}
        hits: list[dict[str, Any]] = []
        asset_id: str | None = None
        agent_tasks_accum: list[dict[str, Any]] = []
        total_steps = 4

        try:
            if run.cancelled:
                return AgentResult(success=False, error="cancelled")

            async def _build_plan() -> None:
                nonlocal search_plan
                display_locale = getattr(req, "display_locale", None) if req is not None else None
                search_plan = await build_search_plan(
                    tenant_id=int(tenant_id) if tenant_id else None,
                    workspace_id=int(workspace_id) if workspace_id else None,
                    messages=list(ctx.messages or []),
                    knowledge=knowledge,
                    display_locale=str(display_locale).strip() if display_locale else None,
                )

            await run_agent_task_step(
                run,
                phase=PHASE_WEB,
                plan=plan,
                run_task=run_task,
                agent=agent,
                agent_task=AgentTaskSpec(
                    id=f"at-{run_task.id}-p",
                    title="Build search plan",
                    agent_id=agent.id,
                    run_task_id=run_task.id,
                    index=1,
                    total=total_steps,
                ),
                pipeline_snap=pipeline_snap or None,
                work=_build_plan,
                agent_tasks_accum=agent_tasks_accum,
            )

            async def _fetch() -> None:
                nonlocal hits
                hits = await execute_search_plan(search_plan)

            await run_agent_task_step(
                run,
                phase=PHASE_WEB,
                plan=plan,
                run_task=run_task,
                agent=agent,
                agent_task=AgentTaskSpec(
                    id=f"at-{run_task.id}-f",
                    title="Fetch snippets",
                    agent_id=agent.id,
                    run_task_id=run_task.id,
                    index=2,
                    total=total_steps,
                ),
                pipeline_snap=pipeline_snap or None,
                work=_fetch,
                agent_tasks_accum=agent_tasks_accum,
            )

            async def _merge() -> None:
                if not hits:
                    return
                lines = ["--- Web search results ---"]
                for i, h in enumerate(hits, start=1):
                    lines.append(
                        f"[W{i}] {h.get('title', '')} — {h.get('url', '')}\n{h.get('snippet', '')}"
                    )
                msgs = list(ctx.messages or [])
                inject_system_message(msgs, "\n\n".join(lines))
                ctx.messages = msgs

            await run_agent_task_step(
                run,
                phase=PHASE_WEB,
                plan=plan,
                run_task=run_task,
                agent=agent,
                agent_task=AgentTaskSpec(
                    id=f"at-{run_task.id}-m",
                    title="Merge into context",
                    agent_id=agent.id,
                    run_task_id=run_task.id,
                    index=3,
                    total=total_steps,
                ),
                pipeline_snap=pipeline_snap or None,
                work=_merge,
                agent_tasks_accum=agent_tasks_accum,
            )

            async def _store() -> None:
                nonlocal asset_id
                if not hits:
                    return
                orient_topics: list[str] = []
                snap = search_plan.get("orientation_snapshot")
                if isinstance(snap, dict) and isinstance(snap.get("topics"), list):
                    orient_topics = [str(t) for t in snap["topics"] if str(t).strip()]

                scope_ref = scope_ref_from_request(req) if req is not None else None
                asset = await persist_web_search_capture(
                    scope_ref=scope_ref,
                    req=req,
                    tenant_id=int(tenant_id) if tenant_id else None,
                    workspace_id=int(workspace_id) if workspace_id else None,
                    conversation_id=str(conversation_id) if conversation_id else None,
                    run_id=str(getattr(run, "run_id", "") or "") or None,
                    search_plan=search_plan,
                    hits=hits,
                    orientation_topics=orient_topics,
                )
                if asset is None:
                    return
                asset_id = asset.asset_id
                schedule_web_knowledge_promotion(
                    asset_id=asset.asset_id,
                    user_id=resolve_user_id(req) if req is not None else None,
                    knowledge=knowledge,
                    coach_endpoint=coach_endpoint_from_request(req) if req else None,
                    workspace_id=int(workspace_id) if workspace_id else None,
                )
                from oaao_orchestrator.knowledge.distill_worker import (
                    schedule_classify_distill_asset,
                )

                schedule_classify_distill_asset(asset.asset_id, knowledge=knowledge)

            await run_agent_task_step(
                run,
                phase=PHASE_WEB,
                plan=plan,
                run_task=run_task,
                agent=agent,
                agent_task=AgentTaskSpec(
                    id=f"at-{run_task.id}-s",
                    title="Store knowledge asset",
                    agent_id=agent.id,
                    run_task_id=run_task.id,
                    index=4,
                    total=total_steps,
                ),
                pipeline_snap=pipeline_snap or None,
                work=_store,
                agent_tasks_accum=agent_tasks_accum,
            )

            await emit_agent_end(
                run,
                phase=PHASE_WEB,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
                failed=not bool(hits),
                agent_tasks=agent_tasks_accum if agent_tasks_accum else None,
            )
        except Exception as exc:
            logger.exception("web_search_agent_failed run_task=%s", run_task.id)
            await emit_agent_end(
                run,
                phase=PHASE_WEB,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
                failed=True,
                agent_tasks=agent_tasks_accum if agent_tasks_accum else None,
            )
            return AgentResult(success=False, error=str(exc)[:400])

        extra: dict[str, Any] = {
            "web_search_hits": hits,
            "web_search_plan": search_plan,
        }
        if asset_id:
            extra["web_knowledge_asset_id"] = asset_id
        if hits:
            blocks = list((ctx.extra or {}).get("pipeline_blocks") or [])
            blocks.append(
                {
                    "kind": "web_search",
                    "type": "web_search",
                    "count": len(hits),
                    "asset_id": asset_id,
                    "plan_method": search_plan.get("method"),
                    "hits": hits[:12],
                }
            )
            extra["pipeline_blocks"] = blocks
        return AgentResult(
            success=True,
            extra=extra,
            note="" if hits else "Web search returned no results — set OAAO_SEARXNG_URL.",
        )
