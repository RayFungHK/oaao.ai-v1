"""ToT / DDTree planner expansions (Audit §7.6)."""

from __future__ import annotations

from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType


def apply_mode_expansion(plan: RunPlan, *, mode_id: str) -> RunPlan:
    """Expand plan for ``tot`` or ``ddtree`` modes — inserts evaluation emit steps."""
    mode = (mode_id or "default").strip().lower()
    if mode not in ("tot", "ddtree"):
        return plan
    tasks = list(plan.tasks)
    insert_at = next((i for i, t in enumerate(tasks) if t.type == RunTaskType.LLM_STREAM), len(tasks))
    marker = RunTaskSpec(
        id=f"rt-mode-{mode}",
        title=f"Mode: {mode} planning branch",
        type=RunTaskType.EMIT,
    )
    tasks.insert(insert_at, marker)
    total = len(tasks)
    for i, spec in enumerate(tasks, start=1):
        spec.index = i
        spec.total = total
    return RunPlan(
        tasks=tasks,
        abilities=list(plan.abilities),
        report_after_task_ids=list(plan.report_after_task_ids),
    )
