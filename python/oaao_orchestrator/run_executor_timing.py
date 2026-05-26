"""W5-S2 phase 2 — Pipeline-timing helpers extracted from run_executor.py.

This module is the single source of truth for the small ``pipeline_timing``
recording helpers. They were previously inline at the top of
``run_executor.py``; pulling them out keeps the executor focused on
orchestration and lets us unit-test the timing shape independently if
needed.

Public surface (re-exported from ``run_executor`` as underscore-prefixed
aliases for back-compat with the existing internal call sites):

- ``elapsed_ms_since(t0)``                 — int ms since a perf-counter mark
- ``record_pipeline_phase(timing, name, duration_ms, **extra)``
- ``record_pipeline_task(timing, run_task, duration_ms)``
- ``finalize_run_task_timing(*, timing, run_task, task_t0)``

The ``pipeline_timing`` dict has the shape::

    {
        "phases": [{"name": str, "duration_ms": int, **extra}, ...],
        "tasks":  [{"id", "title", "type", "status", "duration_ms",
                    "agent_kind"}, ...],
    }
"""

from __future__ import annotations

import time
from typing import Any

from oaao_orchestrator.tasks.models import RunTaskSpec


def elapsed_ms_since(t0: float) -> int:
    """Return milliseconds elapsed since ``t0`` (a ``perf_counter`` mark)."""
    return max(0, int((time.perf_counter() - t0) * 1000))


def record_pipeline_phase(
    pipeline_timing: dict[str, Any], name: str, duration_ms: int, **extra: Any
) -> None:
    """Append a phase row to ``pipeline_timing['phases']`` (creating it if absent)."""
    phases = pipeline_timing.setdefault("phases", [])
    if not isinstance(phases, list):
        phases = []
        pipeline_timing["phases"] = phases
    row: dict[str, Any] = {"name": name, "duration_ms": int(duration_ms)}
    row.update(extra)
    phases.append(row)


def record_pipeline_task(
    pipeline_timing: dict[str, Any],
    run_task: RunTaskSpec,
    duration_ms: int,
) -> None:
    """Append a task row to ``pipeline_timing['tasks']`` (creating it if absent)."""
    tasks = pipeline_timing.setdefault("tasks", [])
    if not isinstance(tasks, list):
        tasks = []
        pipeline_timing["tasks"] = tasks
    tasks.append(
        {
            "id": run_task.id,
            "title": run_task.title,
            "type": str(run_task.type),
            "status": str(run_task.status),
            "duration_ms": int(duration_ms),
            "agent_kind": (run_task.agent_kind or "").strip() or None,
        }
    )


def finalize_run_task_timing(
    *,
    pipeline_timing: dict[str, Any],
    run_task: RunTaskSpec,
    task_t0: float,
) -> int:
    """Stamp ``run_task.duration_ms`` and append a task row. Returns the duration."""
    duration_ms = elapsed_ms_since(task_t0)
    run_task.duration_ms = duration_ms
    record_pipeline_task(pipeline_timing, run_task, duration_ms)
    return duration_ms
