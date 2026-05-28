"""Plan/queue manipulation helpers for `run_executor.execute_chat_run`.

Top-20 #6 phase 4 — these helpers are pure (operate on `RunPlan`/`RunTaskSpec`
queues + request input only) and were lifted out of `run_executor.py` to shrink
the chat-run module toward the agreed ~1500 LOC ceiling. Keep this module
free of `execute_chat_run`-local state.
"""

from __future__ import annotations

import os
from typing import Any

from oaao_orchestrator.planner import needs_multi_agent_turn
from oaao_orchestrator.planner_llm import planner_enabled
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType


def materials_end_snapshot(
    slide_project_meta: dict[str, Any] | None,
    pipeline_snap: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """SD-5 — persistable materials for PHP assistant_patch / IQS."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    if isinstance(slide_project_meta, dict):
        pid = str(slide_project_meta.get("project_id") or "").strip()
        if pid:
            mid = f"slide-{pid}"
            seen.add(mid)
            out.append(
                {
                    "material_id": mid,
                    "kind": "slide_project",
                    "category": "slide",
                    "title": str(slide_project_meta.get("title") or "Slide project"),
                    "meta": {
                        "project_id": pid,
                        "slide_count": slide_project_meta.get("slide_count"),
                        "status": slide_project_meta.get("status"),
                    },
                }
            )
    if isinstance(pipeline_snap, dict):
        arts = pipeline_snap.get("artifacts")
        if isinstance(arts, list):
            for raw in arts:
                if not isinstance(raw, dict):
                    continue
                aid = str(raw.get("id") or "").strip()
                if not aid or aid in seen:
                    continue
                seen.add(aid)
                out.append(
                    {
                        "material_id": aid,
                        "kind": "file",
                        "category": str(raw.get("category") or "document"),
                        "title": str(raw.get("name") or aid),
                        "mime": raw.get("mime"),
                        "size_bytes": raw.get("size_bytes"),
                        "uri": raw.get("uri"),
                        "task_id": raw.get("run_task_id"),
                    }
                )
    return out


def tool_chain_from_plan(plan: RunPlan | None) -> list[str]:
    """Agent kinds executed this run — used for crystallization sealing."""
    if plan is None:
        return []
    chain: list[str] = []
    for task in plan.tasks:
        if task.type == RunTaskType.VAULT_RAG:
            chain.append("vault_rag")
        elif task.type == RunTaskType.LLM_STREAM:
            chain.append("llm_stream")
        elif task.type == RunTaskType.AGENT:
            kind = (task.agent_kind or "").strip()
            if kind:
                chain.append(kind)
    return chain


def plan_pipeline_source(req: object) -> str:
    if not needs_multi_agent_turn(req):
        if bool(getattr(req, "enable_web_search", False)):
            return "composer_web_fast"
        return "fast_chat"
    if planner_enabled(req):
        return "llm_planner"
    return "deterministic"


def reindex_plan(plan: RunPlan) -> None:
    total = len(plan.tasks)
    for i, spec in enumerate(plan.tasks, start=1):
        spec.index = i
        spec.total = total


def insert_tasks_before_llm_stream(
    queue: list[RunTaskSpec], new_tasks: list[RunTaskSpec]
) -> None:
    if not new_tasks:
        return
    stream_idx = next(
        (i for i, t in enumerate(queue) if t.type == RunTaskType.LLM_STREAM), len(queue)
    )
    for offset, task in enumerate(new_tasks):
        queue.insert(stream_idx + offset, task)


def slide_worker_concurrency() -> int:
    raw = (os.environ.get("OAAO_SLIDE_WORKER_CONCURRENCY") or "4").strip()
    try:
        return max(1, min(20, int(raw)))
    except ValueError:
        return 4


def pop_parallel_batch(queue: list[RunTaskSpec]) -> list[RunTaskSpec]:
    if not queue or not queue[0].parallel_ok:
        return []
    batch: list[RunTaskSpec] = []
    while queue and queue[0].parallel_ok:
        batch.append(queue.pop(0))
    return batch


def slide_page_parallel_batch(batch: list[RunTaskSpec]) -> bool:
    if len(batch) < 2:
        return False
    for t in batch:
        if t.type != RunTaskType.AGENT or (t.agent_kind or "").strip() != "slide_designer":
            return False
        phase = str((t.params or {}).get("slide_phase") or "").strip().lower()
        if phase != "page":
            return False
    return True


def inject_slide_project_id(batch: list[RunTaskSpec], project_id: str | None) -> None:
    if not project_id:
        return
    for t in batch:
        params = dict(t.params or {})
        if not params.get("project_id"):
            params["project_id"] = project_id
        t.params = params


def append_tasks_to_plan(
    plan: RunPlan, queue: list[RunTaskSpec], new_tasks: list[RunTaskSpec]
) -> None:
    if not new_tasks:
        return
    existing_ids = {t.id for t in plan.tasks}
    for t in new_tasks:
        if t.id in existing_ids:
            t.id = f"{t.id}-r{len(existing_ids)}"
        existing_ids.add(t.id)
        plan.tasks.append(t)
    streams = [t for t in plan.tasks if t.type == RunTaskType.LLM_STREAM]
    rest = [t for t in plan.tasks if t.type != RunTaskType.LLM_STREAM]
    if streams:
        plan.tasks = rest + streams[-1:]
    insert_tasks_before_llm_stream(queue, new_tasks)
    reindex_plan(plan)
