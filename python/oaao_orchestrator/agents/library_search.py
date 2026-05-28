"""CS-2-S8 — library_search agent (attach-only Soft-RAG)."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.library.search import run_library_search
from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.events import PHASE_RAG
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.agent_emit import emit_agent_end, emit_agent_start
from oaao_orchestrator.tasks.models import (
    AgentResult,
    AgentSpec,
    AgentStatus,
    RunPlan,
    RunTaskSpec,
)
from oaao_orchestrator.vault_rag.messages import inject_system_message, last_user_query

logger = logging.getLogger(__name__)


def _chat_request(ctx: RunContext) -> Any:
    return ctx.extra.get("chat_request")


def _library_doc_ids(req: Any, run_task: RunTaskSpec) -> list[int]:
    params = run_task.params if isinstance(run_task.params, dict) else {}
    raw = params.get("document_ids")
    if isinstance(raw, list) and raw:
        return sorted({int(x) for x in raw if int(x) > 0})
    raw_req = getattr(req, "library_doc_ids", None) if req is not None else None
    if isinstance(raw_req, list) and raw_req:
        return sorted({int(x) for x in raw_req if int(x) > 0})
    return []


def _format_library_hits(hits: list[dict[str, Any]]) -> str:
    if not hits:
        return (
            "Library search returned no passages for the attached document(s). "
            "Answer from conversation context only; do not claim library access."
        )
    lines = ["Library document excerpts (attached @library only — not vault):"]
    for i, hit in enumerate(hits[:12], start=1):
        if not isinstance(hit, dict):
            continue
        title = str(hit.get("title") or f"doc#{hit.get('document_id') or '?'}").strip()
        text = str(hit.get("text") or "").strip()
        score = hit.get("score")
        prefix = f"[{i}] {title}"
        if score is not None:
            prefix += f" (score={score})"
        lines.append(f"{prefix}\n{text[:2400]}")
    return "\n\n".join(lines)


class LibrarySearchAgent:
    agent_kind = "library_search"

    async def run(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
    ) -> AgentResult:
        req = _chat_request(ctx)
        doc_ids = _library_doc_ids(req, run_task)
        if not doc_ids:
            return AgentResult(success=True, error=None, extra={"library_search_skipped": True})

        tenant_id = getattr(req, "tenant_id", None) if req is not None else None
        if tenant_id is None or int(tenant_id) < 1:
            return AgentResult(success=False, error="library_search_missing_tenant_id")

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
            phase=PHASE_RAG,
            plan=plan,
            run_task=run_task,
            agent=agent,
            pipeline_snap=pipeline_snap or None,
        )

        query = last_user_query(list(ctx.messages or []))
        embedding_cfg = getattr(req, "embedding", None) if req is not None else None
        payload: dict[str, Any] = {
            "tenant_id": int(tenant_id),
            "query": query or "summary",
            "document_ids": doc_ids,
            "limit": 8,
            "min_score": 0.32,
        }
        if isinstance(embedding_cfg, dict):
            payload["embedding_cfg"] = embedding_cfg

        try:
            if run.cancelled:
                return AgentResult(success=False, error="cancelled")
            result = await run_library_search(payload)
            if not result.get("ok"):
                err = str(result.get("error") or "library_search_failed")
                await emit_agent_end(
                    run,
                    phase=PHASE_RAG,
                    plan=plan,
                    run_task=run_task,
                    agent=agent,
                    pipeline_snap=pipeline_snap or None,
                    success=False,
                )
                return AgentResult(success=False, error=err)

            hits = result.get("hits")
            hit_list = [h for h in hits if isinstance(h, dict)] if isinstance(hits, list) else []
            brief = _format_library_hits(hit_list)
            messages = list(ctx.messages or [])
            inject_system_message(messages, brief)
            ctx.messages = list(messages)

            pipeline_snap = dict(pipeline_snap)
            pipeline_snap["library_search_hits"] = hit_list
            pipeline_snap["blocks"] = list(pipeline_snap.get("blocks") or []) + [
                {
                    "kind": "library_search",
                    "type": "library_search",
                    "hits": hit_list,
                    "document_ids": doc_ids,
                }
            ]

            await emit_agent_end(
                run,
                phase=PHASE_RAG,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap,
                success=True,
            )
            return AgentResult(
                success=True,
                extra={
                    "messages": messages,
                    "pipeline_snap": pipeline_snap,
                    "library_search_hits": hit_list,
                    "library_doc_ids": doc_ids,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("library_search_agent_failed run_task=%s", run_task.id)
            await emit_agent_end(
                run,
                phase=PHASE_RAG,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
                success=False,
            )
            return AgentResult(success=False, error=str(exc)[:500])
