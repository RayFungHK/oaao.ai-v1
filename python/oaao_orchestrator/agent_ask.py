"""Agent ask-stage — catalog helpers and wait/resume for user confirmation."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from oaao_orchestrator.planner_catalog import catalog_from_request
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.models import RunTaskSpec, RunTaskStatus, RunTaskType

logger = logging.getLogger(__name__)

ASK_DECISION_PROCEED = "proceed"
ASK_DECISION_SKIP = "skip"
ASK_DECISION_PROCEED_FORK = "proceed_fork"
ASK_DECISIONS = frozenset(
    {ASK_DECISION_PROCEED, ASK_DECISION_SKIP, ASK_DECISION_PROCEED_FORK},
)
ASK_TIMEOUT_SEC = 600.0


def ask_meta_for_agent(agent_kind: str, *, catalog: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Return ask_stage metadata when the agent registered ask_enabled."""
    kind = (agent_kind or "").strip()
    if not kind or catalog is None:
        return None
    entry = catalog.get(kind)
    if entry is None or not getattr(entry, "ask_enabled", False):
        return None
    return {
        "agent_kind": kind,
        "title": getattr(entry, "ask_title", None) or getattr(entry, "name", kind),
        "default_message": getattr(entry, "ask_default_message", None) or "",
        "proceed_label": getattr(entry, "ask_proceed_label", None) or "Run",
        "skip_label": getattr(entry, "ask_skip_label", None) or "Skip",
    }


def task_needs_user_ask(
    run_task: RunTaskSpec,
    req: object | None,
) -> tuple[bool, str, dict[str, Any] | None]:
    """True when the planner requested confirmation before running this agent task."""
    if run_task.type != RunTaskType.AGENT:
        return False, "", None
    kind = (run_task.agent_kind or "").strip()
    if not kind:
        return False, "", None
    if not bool(run_task.params.get("requires_ask")):
        return False, "", None

    cat = catalog_from_request(req)
    ask_meta = ask_meta_for_agent(kind, catalog=cat)
    msg = str(run_task.params.get("ask_message") or "").strip()
    if not msg and ask_meta:
        msg = str(ask_meta.get("default_message") or "").strip()
    if not msg:
        msg = f"Run {kind} for this request?"
    return True, msg, ask_meta


async def wait_for_agent_ask_decision(
    run: StreamRun,
    *,
    run_task_id: str,
    timeout_sec: float = ASK_TIMEOUT_SEC,
) -> str:
    fut = run.register_agent_ask(run_task_id)
    try:
        return await asyncio.wait_for(fut, timeout=timeout_sec)
    except asyncio.TimeoutError:
        logger.info("agent_ask_timeout run_id=%s task_id=%s", run.run_id, run_task_id)
        run.discard_agent_ask(run_task_id)
        return ASK_DECISION_SKIP
