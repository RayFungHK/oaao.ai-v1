"""
Vault RAG agent — wraps ``augment_chat_messages_for_vault_rag`` with agent / agent-task SSE frames.
"""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.events import PHASE_RAG
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
from oaao_orchestrator.vault_graph_rag import (
    VaultRagOutcome,
    augment_chat_messages_for_vault_rag,
    build_pipeline_snapshot_for_rag,
)

logger = logging.getLogger(__name__)


def _vault_params(ctx: RunContext) -> dict[str, Any]:
    raw = ctx.extra.get("vault_rag")
    return raw if isinstance(raw, dict) else {}


class VaultRagAgent:
    agent_kind = "vault_rag"

    async def run(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
    ) -> AgentResult:
        params = _vault_params(ctx)
        plan_raw = ctx.extra.get("run_plan")
        plan = plan_raw if isinstance(plan_raw, RunPlan) else RunPlan()
        pipeline_base = params.get("pipeline_snap_base")
        base_snap = dict(pipeline_base) if isinstance(pipeline_base, dict) else {}

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
            pipeline_snap=base_snap or None,
        )

        outcome: VaultRagOutcome | None = None
        pipeline_snap: dict[str, Any] = dict(base_snap)

        rag_task = AgentTaskSpec(
            id=f"at-{run_task.id}-rag",
            title="Search knowledge base",
            agent_id=agent.id,
            run_task_id=run_task.id,
            index=1,
            total=1,
        )

        try:
            if run.cancelled:
                return AgentResult(success=False, error="cancelled")
            profiles = params.get("vault_retrieval_profiles")
            profile_list = [p for p in (profiles or []) if isinstance(p, dict)]

            async def _run_rag() -> None:
                nonlocal outcome, pipeline_snap
                messages = list(ctx.messages)
                outcome = await augment_chat_messages_for_vault_rag(
                    messages,
                    profile_list,
                    embedding=params.get("embedding")
                    if isinstance(params.get("embedding"), dict)
                    else None,
                    vault_source_refs=params.get("vault_source_refs")
                    if isinstance(params.get("vault_source_refs"), list)
                    else None,
                    vault_scope_documents=params.get("vault_scope_documents")
                    if isinstance(params.get("vault_scope_documents"), dict)
                    else None,
                    vault_auto_rag=bool(params.get("vault_auto_rag")),
                    vault_document_catalog=params.get("vault_document_catalog")
                    if isinstance(params.get("vault_document_catalog"), dict)
                    else None,
                    vault_rag=params.get("vault_rag_config")
                    if isinstance(params.get("vault_rag_config"), dict)
                    else None,
                )
                ctx.messages = messages
                if outcome is None:
                    outcome = VaultRagOutcome(passage_count=0, profile_hits=0)
                pipeline_snap = build_pipeline_snapshot_for_rag(outcome, pipeline_snap)

            rag_steps_accum: list[dict[str, Any]] = []
            await run_agent_task_step(
                run,
                phase=PHASE_RAG,
                plan=plan,
                run_task=run_task,
                agent=agent,
                agent_task=rag_task,
                pipeline_snap=pipeline_snap or None,
                work=_run_rag,
                agent_tasks_accum=rag_steps_accum,
            )

            brief = (outcome.slide_grounding_brief if outcome else "").strip()
            if brief:
                arts = pipeline_snap.get("artifacts")
                if not isinstance(arts, list):
                    arts = []
                arts = [
                    a
                    for a in arts
                    if not (
                        isinstance(a, dict)
                        and str(a.get("agent_kind") or "") == "vault_rag"
                        and str(a.get("id") or "").startswith("vault-grounding-")
                    )
                ]
                arts.append(
                    {
                        "id": f"vault-grounding-{run_task.id}",
                        "name": "Vault retrieval context",
                        "mime": "text/markdown",
                        "agent_kind": "vault_rag",
                        "run_task_id": run_task.id,
                        "body": brief[:14_000],
                    }
                )
                pipeline_snap["artifacts"] = arts

            await emit_agent_end(
                run,
                phase=PHASE_RAG,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap,
                agent_tasks=rag_steps_accum if rag_steps_accum else None,
            )
            return AgentResult(
                success=True,
                extra={
                    "messages": list(ctx.messages),
                    "pipeline_snap": pipeline_snap,
                    "vault_grounding_for_slides": brief,
                    "vault_rag_outcome": {
                        "passage_count": outcome.passage_count if outcome else 0,
                        "profile_hits": outcome.profile_hits if outcome else 0,
                    },
                },
            )
        except Exception as exc:
            logger.exception("vault_rag_agent_failed run_task=%s", run_task.id)
            await emit_agent_end(
                run,
                phase=PHASE_RAG,
                plan=plan,
                run_task=run_task,
                agent=agent,
                pipeline_snap=pipeline_snap or None,
                failed=True,
                agent_tasks=rag_steps_accum if rag_steps_accum else None,
            )
            return AgentResult(success=False, error=str(exc)[:400])
