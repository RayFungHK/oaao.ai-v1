"""Helpers — task pipeline frames on ``StreamRun``."""

from __future__ import annotations

from typing import Any

from oaao_orchestrator.streaming.events import KIND_END, KIND_START, KIND_STATUS, PHASE_TASK, StreamEnvelope

KIND_ASK = "ask"
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.models import (
    AgentStatus,
    AgentView,
    RunPlan,
    RunTaskSpec,
    RunTaskStatus,
    RunTaskType,
    _aggregate_run_task_statuses,
)


def resolve_run_task_agent_kind(run_task: RunTaskSpec) -> str | None:
    """Registry key when this run task is agent-backed (vault_rag, sandbox_code, …)."""
    kind = (run_task.agent_kind or "").strip()
    if kind:
        return kind
    if run_task.type == RunTaskType.VAULT_RAG:
        return "vault_rag"
    if run_task.type == RunTaskType.AGENT:
        return None
    return None


def agent_view_for_run_task(
    run_task: RunTaskSpec,
    *,
    status: AgentStatus | None = None,
) -> dict[str, Any] | None:
    kind = resolve_run_task_agent_kind(run_task)
    if not kind:
        return None
    if status is None:
        if run_task.status == RunTaskStatus.ACTIVE:
            status = AgentStatus.RUNNING
        elif run_task.status == RunTaskStatus.FAILED:
            status = AgentStatus.FAILED
        elif run_task.status == RunTaskStatus.DONE:
            status = AgentStatus.DONE
        else:
            status = AgentStatus.SCHEDULED
    return AgentView(
        id=f"ag-{run_task.id}",
        run_task_id=run_task.id,
        kind=kind,
        status=status,
    ).model_dump()


def ensure_run_task_agent_kind(run_task: RunTaskSpec) -> None:
    """Set ``agent_kind`` on built-in agent run tasks before task-level SSE."""
    if run_task.type == RunTaskType.VAULT_RAG and not (run_task.agent_kind or "").strip():
        run_task.agent_kind = "vault_rag"


def merge_agent_tasks_into_task_list(
    task_list: dict[str, Any],
    run_task_id: str,
    agent_tasks: list[dict[str, Any]],
) -> None:
    """Attach live agent sub-step rows to one checklist item (``tasks.items[]``)."""
    items = task_list.get("items")
    if not isinstance(items, list):
        return
    for row in items:
        if isinstance(row, dict) and str(row.get("id") or "") == run_task_id:
            row["agent_tasks"] = list(agent_tasks)
            return


def slide_workers_parent_id(run_task: RunTaskSpec) -> str | None:
    """Parent checklist id for SD-4 parallel page workers ({group}-slides)."""
    params = run_task.params if isinstance(run_task.params, dict) else {}
    if str(params.get("slide_phase") or "").strip().lower() != "page":
        return None
    group = str(params.get("slide_group") or "").strip()
    if not group and "-slide-" in run_task.id:
        group = run_task.id.rsplit("-slide-", 1)[0]
    return f"{group}-slides" if group else None


def merge_slide_worker_row(
    task_list: dict[str, Any],
    run_task: RunTaskSpec,
    *,
    status: str,
    title: str | None = None,
    preview: dict[str, Any] | None = None,
) -> None:
    """Upsert one parallel slide page row under ``{slide_group}-slides``."""
    parent_id = slide_workers_parent_id(run_task)
    if not parent_id:
        return
    items = task_list.get("items")
    if not isinstance(items, list):
        return
    row: dict[str, Any] = {
        "id": run_task.id,
        "title": title or run_task.title,
        "status": status,
    }
    if preview is not None:
        row["preview"] = preview
    for item in items:
        if not isinstance(item, dict) or str(item.get("id") or "") != parent_id:
            continue
        workers = [w for w in (item.get("agent_tasks") or []) if isinstance(w, dict)]
        merged = False
        for i, w in enumerate(workers):
            if str(w.get("id") or "") == run_task.id:
                workers[i] = {**w, **row}
                merged = True
                break
        if not merged:
            workers.append(row)
        item["agent_tasks"] = workers
        agg = _aggregate_run_task_statuses(
            [str(w.get("status") or "pending") for w in workers]
        )
        item["status"] = agg.value if hasattr(agg, "value") else str(agg)
        return


def _task_payload(
    plan: RunPlan,
    run_task: RunTaskSpec | None,
    *,
    allowed_agents: list[str] | None = None,
    pipeline_snap: dict[str, Any] | None = None,
    agent_tasks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "tasks": plan.task_list_payload(allowed_agents=allowed_agents),
    }
    if run_task is not None:
        payload["run_task"] = plan.run_task_view(run_task)
        agent = agent_view_for_run_task(run_task)
        if agent is not None:
            payload["agent"] = agent
    if agent_tasks:
        payload["agent_tasks"] = agent_tasks
    if pipeline_snap is not None:
        payload["oaao_pipeline"] = pipeline_snap
    return payload


async def emit_task_list_status(
    run: StreamRun,
    plan: RunPlan,
    *,
    allowed_agents: list[str] | None = None,
    pipeline_snap: dict[str, Any] | None = None,
    text: str = "task_plan",
) -> None:
    await run.append(
        StreamEnvelope(
            phase=PHASE_TASK,
            kind=KIND_STATUS,
            text=text,
            payload=_task_payload(
                plan, None, allowed_agents=allowed_agents, pipeline_snap=pipeline_snap
            ),
        )
    )


async def emit_run_task_start(
    run: StreamRun,
    plan: RunPlan,
    run_task: RunTaskSpec,
    *,
    allowed_agents: list[str] | None = None,
    pipeline_snap: dict[str, Any] | None = None,
) -> None:
    await run.append(
        StreamEnvelope(
            phase=PHASE_TASK,
            kind=KIND_START,
            step_id=run_task.id,
            text=run_task.title,
            payload=_task_payload(
                plan, run_task, allowed_agents=allowed_agents, pipeline_snap=pipeline_snap
            ),
        )
    )


async def emit_agent_ask(
    run: StreamRun,
    plan: RunPlan,
    run_task: RunTaskSpec,
    *,
    message: str,
    ask_meta: dict[str, Any] | None = None,
    allowed_agents: list[str] | None = None,
    pipeline_snap: dict[str, Any] | None = None,
    mode_switch: bool = False,
    suggest_fork: bool = False,
    fork_recommended: bool = False,
    target_mode: str = "default",
    prior_agent_kind: str = "",
    fork_hint: str = "",
) -> None:
    payload = _task_payload(
        plan, run_task, allowed_agents=allowed_agents, pipeline_snap=pipeline_snap
    )
    meta = ask_meta if isinstance(ask_meta, dict) else {}
    payload["agent_ask"] = {
        "run_task_id": run_task.id,
        "run_id": run.run_id,
        "agent_kind": run_task.agent_kind,
        "message": message,
        "title": meta.get("title") or run_task.title,
        "proceed_label": meta.get("proceed_label") or "Run",
        "skip_label": meta.get("skip_label") or "Skip",
        "mode_switch": bool(mode_switch or meta.get("mode_switch")),
        "suggest_fork": bool(suggest_fork or meta.get("suggest_fork")),
        "fork_recommended": bool(fork_recommended or meta.get("fork_recommended")),
        "target_mode": str(target_mode or meta.get("target_mode") or "default"),
        "prior_agent_kind": str(prior_agent_kind or meta.get("prior_agent_kind") or ""),
        "fork_hint": str(fork_hint or meta.get("fork_hint") or ""),
        "proceed_same_label": meta.get("proceed_same_label") or "Continue here",
        "proceed_fork_label": meta.get("proceed_fork_label") or "New chat for this mode",
    }
    await run.append(
        StreamEnvelope(
            phase=PHASE_TASK,
            kind=KIND_ASK,
            step_id=run_task.id,
            text="agent_ask",
            payload=payload,
        )
    )


async def emit_run_task_end(
    run: StreamRun,
    plan: RunPlan,
    run_task: RunTaskSpec,
    *,
    allowed_agents: list[str] | None = None,
    pipeline_snap: dict[str, Any] | None = None,
    failed: bool = False,
) -> None:
    await run.append(
        StreamEnvelope(
            phase=PHASE_TASK,
            kind=KIND_END,
            step_id=run_task.id,
            text=run_task.title if not failed else f"{run_task.title} (failed)",
            payload=_task_payload(
                plan, run_task, allowed_agents=allowed_agents, pipeline_snap=pipeline_snap
            ),
        )
    )
