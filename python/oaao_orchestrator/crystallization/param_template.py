"""Extract reusable param templates from executed run plans (Evolution §8)."""

from __future__ import annotations

from typing import Any

from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType


def extract_param_template(plan: RunPlan | None) -> dict[str, Any]:
    """Summarize RunTaskSpec params for crystallized skill replay."""
    if plan is None:
        return {}
    tasks: list[dict[str, Any]] = []
    for spec in plan.tasks:
        row: dict[str, Any] = {
            "type": str(spec.type.value if hasattr(spec.type, "value") else spec.type),
            "title": spec.title,
        }
        if spec.agent_kind:
            row["agent_kind"] = spec.agent_kind
        params = spec.params if isinstance(spec.params, dict) else {}
        if params:
            row["params"] = dict(params)
        tasks.append(row)
    return {"tasks": tasks}


def extract_param_template_from_tasks(tasks: list[RunTaskSpec] | None) -> dict[str, Any]:
    if not tasks:
        return {}
    pseudo = RunPlan(tasks=list(tasks), abilities=[], report_after_task_ids=[])
    return extract_param_template(pseudo)
