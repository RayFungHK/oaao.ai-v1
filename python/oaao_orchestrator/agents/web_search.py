"""Web search agent — replaces stub when SearXNG is configured."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.events import PHASE_WEB
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.agent_emit import emit_agent_end, emit_agent_start, run_agent_task_step
from oaao_orchestrator.tasks.models import AgentResult, AgentSpec, AgentStatus, AgentTaskSpec, RunTaskSpec
from oaao_orchestrator.tools.web_search import web_search
from oaao_orchestrator.vault_graph_rag import inject_system_message, last_user_query

logger = logging.getLogger(__name__)


class WebSearchAgent:
    agent_kind = "web_search"

    async def run(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
    ) -> AgentResult:
        query = last_user_query(list(ctx.messages or []))
        agent = AgentSpec(id=f"ag-{run_task.id}", kind=self.agent_kind, title="Web search")
        await emit_agent_start(run, agent)
        await run_agent_task_step(
            run,
            agent=agent,
            task=AgentTaskSpec(id=f"at-{run_task.id}-q", title="Formulate query", index=1, total=3),
            status=AgentStatus.DONE,
            phase=PHASE_WEB,
            detail=query[:200] if query else "(empty)",
        )
        hits = await web_search(query)
        await run_agent_task_step(
            run,
            agent=agent,
            task=AgentTaskSpec(id=f"at-{run_task.id}-f", title="Fetch snippets", index=2, total=3),
            status=AgentStatus.DONE if hits else AgentStatus.FAILED,
            phase=PHASE_WEB,
            detail=f"{len(hits)} results",
        )
        if hits:
            lines = ["--- Web search results ---"]
            for i, h in enumerate(hits, start=1):
                lines.append(f"[W{i}] {h.get('title', '')} — {h.get('url', '')}\n{h.get('snippet', '')}")
            inject_system_message(list(ctx.messages), "\n\n".join(lines))
            ctx.messages = list(ctx.messages)
        await run_agent_task_step(
            run,
            agent=agent,
            task=AgentTaskSpec(id=f"at-{run_task.id}-m", title="Merge into context", index=3, total=3),
            status=AgentStatus.DONE,
            phase=PHASE_WEB,
        )
        await emit_agent_end(run, agent, success=bool(hits))
        extra: dict[str, Any] = {"web_search_hits": hits}
        if hits:
            blocks = list((ctx.extra or {}).get("pipeline_blocks") or [])
            blocks.append({"kind": "web_search", "count": len(hits)})
            extra["pipeline_blocks"] = blocks
        return AgentResult(
            success=True,
            extra=extra,
            note="" if hits else "Web search returned no results — set OAAO_SEARXNG_URL.",
        )
