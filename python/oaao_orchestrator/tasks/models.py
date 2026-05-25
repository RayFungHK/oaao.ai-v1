"""
Run / Agent task specs — planner output and executor input.

See ``backbone/sites/oaaoai/oaaoai/docs/backlog/chat-task-pipeline.md``.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class RunTaskStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    AWAITING_ASK = "awaiting_ask"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"


class AgentTaskStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class AgentStatus(StrEnum):
    SCHEDULED = "scheduled"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class RunTaskType(StrEnum):
    """Top-level run step — maps to Legacy ``hub.proto`` TaskType where noted."""

    EMIT = "emit"
    VAULT_RAG = "vault_rag"
    ATTACHMENTS = "attachments"
    LLM_STREAM = "llm_stream"
    LLM_CALL = "llm_call"
    AGENT = "agent"


class RunTaskSpec(BaseModel):
    """One checklist row executed by ``RunExecutor`` (Phase 1+)."""

    id: str
    title: str
    type: RunTaskType
    status: RunTaskStatus = RunTaskStatus.PENDING
    index: int = 0
    total: int = 0
    depends_on: list[str] = Field(default_factory=list)
    agent_kind: str | None = Field(
        default=None,
        description="Required when type=agent — registry key (sandbox_code, slides, …).",
    )
    params: dict[str, Any] = Field(default_factory=dict)
    parallel_ok: bool = Field(
        default=False,
        description="When true, executor may schedule alongside other parallel_ok tasks (future).",
    )
    duration_ms: int | None = Field(
        default=None,
        description="Wall-clock ms for this step (executor sets on completion).",
    )


class AgentTaskSpec(BaseModel):
    """Sub-step inside an ``AgentRunner`` (tool call, sub-LLM, file IO)."""

    id: str
    title: str
    agent_id: str
    run_task_id: str
    status: AgentTaskStatus = AgentTaskStatus.PENDING
    index: int = 0
    total: int = 0
    params: dict[str, Any] = Field(default_factory=dict)


class AgentSpec(BaseModel):
    """Running agent instance bound to one run task."""

    id: str
    run_task_id: str
    kind: str
    status: AgentStatus = AgentStatus.SCHEDULED


class AgentTaskListItem(BaseModel):
    """Sub-step row nested under a run task (persisted for IQS / history UI)."""

    id: str
    title: str
    status: AgentTaskStatus | str = AgentTaskStatus.PENDING
    preview: dict[str, Any] | None = Field(
        default=None,
        description="Optional inline preview (slide thumb, HTML snippet, …) for task UI.",
    )


class TaskListItem(BaseModel):
    """Checklist row pushed to the frontend via ``payload.tasks.items``."""

    id: str
    title: str
    status: RunTaskStatus | str = RunTaskStatus.PENDING
    agent_kind: str | None = None
    agent_tasks: list[AgentTaskListItem] = Field(default_factory=list)
    parallel_ok: bool = False
    slide_index: int | None = None
    slide_workers: bool = Field(
        default=False,
        description="True when agent_tasks are parallel slide page run tasks (SD-4 UI).",
    )
    duration_ms: int | None = None


class AbilityHint(BaseModel):
    name: str
    description: str = ""
    ask_enabled: bool = False
    ask_hint: str = ""
    ask_default_message: str = ""
    ask_title: str = ""
    ask_proceed_label: str = ""
    ask_skip_label: str = ""


class TaskListPayload(BaseModel):
    """Legacy ``task_list`` SSE equivalent — ``StreamEnvelope.payload['tasks']``."""

    items: list[TaskListItem] = Field(default_factory=list)
    abilities: list[AbilityHint] = Field(default_factory=list)
    allowed_agents: list[str] = Field(default_factory=list)
    collapsed: bool = False


class RunTaskView(BaseModel):
    """Serializable run-task row for stream payloads (``payload.run_task``)."""

    id: str
    index: int
    total: int
    title: str
    type: RunTaskType | str
    status: RunTaskStatus | str
    agent_kind: str | None = None
    duration_ms: int | None = None


class AgentView(BaseModel):
    id: str
    run_task_id: str
    kind: str
    status: AgentStatus | str


class AgentTaskView(BaseModel):
    id: str
    agent_id: str
    run_task_id: str
    title: str
    status: AgentTaskStatus | str
    preview: dict[str, Any] | None = None


class AgentResult(BaseModel):
    """Returned when an agent finishes — executor may append follow-up run tasks."""

    success: bool = True
    error: str | None = None
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    extra: dict[str, Any] = Field(default_factory=dict)


def _worker_preview_from_page_task(t: RunTaskSpec) -> dict[str, Any] | None:
    """Seed worker row preview from completed page task (persisted in meta)."""
    params = t.params if isinstance(t.params, dict) else {}
    if str(params.get("slide_phase") or "").strip().lower() != "page":
        return None
    st = str(t.status).lower()
    if st not in ("done", "failed"):
        return None
    preview = params.get("preview")
    if isinstance(preview, dict) and preview:
        return preview
    try:
        idx = int(params.get("slide_index") or 0)
    except (TypeError, ValueError):
        return None
    if idx < 1:
        return None
    try:
        total = int(params.get("slide_count") or 0)
    except (TypeError, ValueError):
        total = 0
    slide_title = str(params.get("slide_title") or "").strip()
    out: dict[str, Any] = {
        "kind": "slide_page",
        "phase": "ready" if st == "done" else "failed",
        "slide_index": idx,
        "slide_count": total or idx,
        "building": False,
    }
    if slide_title:
        out["title"] = slide_title
    url = params.get("preview_url")
    if isinstance(url, str) and url.strip():
        out["preview_url"] = url.strip()
    return out


def _aggregate_run_task_statuses(statuses: list[RunTaskStatus | str]) -> RunTaskStatus:
    """Roll up parallel slide page workers for the task-list parent row."""
    vals = [str(s).lower() for s in statuses if s is not None]
    if not vals:
        return RunTaskStatus.PENDING
    if any(v in ("active", "running") for v in vals):
        return RunTaskStatus.ACTIVE
    if any(v == "failed" for v in vals):
        return RunTaskStatus.FAILED
    if all(v in ("done", "completed") for v in vals):
        return RunTaskStatus.DONE
    if any(v == "skipped" for v in vals):
        return RunTaskStatus.SKIPPED
    return RunTaskStatus.PENDING


class RunPlan(BaseModel):
    """Planner output — ordered run tasks for one chat turn."""

    run_id: str | None = None
    tasks: list[RunTaskSpec] = Field(default_factory=list)
    abilities: list[AbilityHint] = Field(default_factory=list)
    report_after_task_ids: list[str] = Field(
        default_factory=list,
        description="After these run-task ids complete, one report-result replan may append tasks (Phase 2).",
    )
    slide_designer: dict[str, Any] | None = Field(
        default=None,
        description="Effective slide_designer config after planner slide_action merge (executor / agents).",
    )
    conversation_title: str | None = Field(
        default=None,
        description="Planner-suggested sidebar title for a new chat thread.",
    )

    def task_list_payload(self, *, allowed_agents: list[str] | None = None) -> dict[str, Any]:
        from oaao_orchestrator.tasks.stream_emit import resolve_run_task_agent_kind  # noqa: PLC0415

        item_rows: list[TaskListItem] = []
        tasks = self.tasks
        i = 0
        while i < len(tasks):
            t = tasks[i]
            params = t.params if isinstance(t.params, dict) else {}
            phase = str(params.get("slide_phase") or "").strip().lower()
            if phase == "page":
                group = str(params.get("slide_group") or "").strip()
                if not group and "-slide-" in t.id:
                    group = t.id.rsplit("-slide-", 1)[0]
                pages: list[RunTaskSpec] = []
                while i < len(tasks):
                    tt = tasks[i]
                    p2 = tt.params if isinstance(tt.params, dict) else {}
                    if str(p2.get("slide_phase") or "").strip().lower() != "page":
                        break
                    g2 = str(p2.get("slide_group") or "").strip()
                    if not g2 and "-slide-" in tt.id:
                        g2 = tt.id.rsplit("-slide-", 1)[0]
                    if g2 != group:
                        break
                    pages.append(tt)
                    i += 1
                parent_id = f"{group}-slides"
                count = len(pages)
                workers = [
                    AgentTaskListItem(
                        id=p.id,
                        title=p.title,
                        status=p.status,
                        preview=_worker_preview_from_page_task(p),
                    )
                    for p in pages
                ]
                item_rows.append(
                    TaskListItem(
                        id=parent_id,
                        title=f"Build slide pages ({count})",
                        status=_aggregate_run_task_statuses([p.status for p in pages]),
                        agent_kind="slide_designer",
                        agent_tasks=workers,
                        parallel_ok=True,
                        slide_workers=True,
                    )
                )
                continue

            slide_idx = None
            if params.get("slide_index") is not None:
                try:
                    slide_idx = int(params["slide_index"])
                except (TypeError, ValueError):
                    slide_idx = None
            item_rows.append(
                TaskListItem(
                    id=t.id,
                    title=t.title,
                    status=t.status,
                    agent_kind=resolve_run_task_agent_kind(t),
                    parallel_ok=bool(t.parallel_ok),
                    slide_index=slide_idx,
                    duration_ms=t.duration_ms,
                )
            )
            i += 1

        data = TaskListPayload(
            items=item_rows,
            abilities=list(self.abilities),
            allowed_agents=list(allowed_agents or []),
        ).model_dump()
        for row in data.get("items") or []:
            if isinstance(row, dict) and not row.get("slide_workers"):
                row.pop("agent_tasks", None)
        return data

    def run_task_view(self, task: RunTaskSpec) -> dict[str, Any]:
        return RunTaskView(
            id=task.id,
            index=task.index,
            total=task.total,
            title=task.title,
            type=task.type,
            status=task.status,
            agent_kind=task.agent_kind,
            duration_ms=task.duration_ms,
        ).model_dump()
