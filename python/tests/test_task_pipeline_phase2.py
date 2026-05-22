"""Phase 2 — LLM planner parsing, abilities, report-result merge."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.planner import build_default_run_plan, resolve_allowed_agents
from oaao_orchestrator.planner_llm import (
    PlannerOutputDraft,
    PlannerTaskDraft,
    planner_enabled,
    planner_mode,
    planner_output_to_run_plan,
)
from oaao_orchestrator.run_executor import _append_tasks_to_plan, _insert_tasks_before_llm_stream
from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType


def test_resolve_allowed_agents_from_request() -> None:
    req = SimpleNamespace(allowed_agents=["slides", "sandbox_code"])
    assert resolve_allowed_agents(req) == ["slides", "sandbox_code"]


def test_planner_mode_from_request_overrides_env(monkeypatch) -> None:
    monkeypatch.setenv("OAAO_RUN_PLANNER_MODE", "llm")
    req = SimpleNamespace(run_planner_mode="stub")
    assert planner_mode(req) == "stub"
    assert planner_enabled(req) is False


def test_planner_mode_falls_back_to_env(monkeypatch) -> None:
    monkeypatch.setenv("OAAO_RUN_PLANNER_MODE", "stub")
    req = SimpleNamespace(run_planner_mode=None)
    assert planner_mode(req) == "stub"
    assert planner_enabled(req) is False


def test_planner_output_normalizes_llm_stream_last() -> None:
    draft = PlannerOutputDraft(
        tasks=[
            PlannerTaskDraft(id="rt-1", title="Answer", type="llm_stream"),
            PlannerTaskDraft(id="rt-2", title="Search", type="vault_rag"),
        ],
        abilities=[],
        report_after=["rt-2"],
    )
    plan = planner_output_to_run_plan(
        draft,
        allowed_agents=["sandbox_code"],
        require_vault=True,
        require_attachments=False,
    )
    assert plan.tasks[-1].type == RunTaskType.LLM_STREAM
    assert plan.tasks[0].type == RunTaskType.VAULT_RAG
    assert plan.report_after_task_ids == ["rt-2"]


def test_insert_before_llm_stream() -> None:
    queue = [
        RunTaskSpec(id="a", title="A", type=RunTaskType.VAULT_RAG, index=1, total=2),
        RunTaskSpec(id="b", title="B", type=RunTaskType.LLM_STREAM, index=2, total=2),
    ]
    extra = [RunTaskSpec(id="x", title="X", type=RunTaskType.LLM_CALL)]
    _insert_tasks_before_llm_stream(queue, extra)
    assert [t.id for t in queue] == ["a", "x", "b"]


def test_append_tasks_to_plan_reindexes() -> None:
    plan = build_default_run_plan(
        SimpleNamespace(
            vault_auto_rag=False,
            vault_source_refs=[],
            vault_source_ids=[],
            vault_scope_documents={},
            chat_attachments=[],
        )
    )
    queue = list(plan.tasks)
    before = len(plan.tasks)
    _append_tasks_to_plan(
        plan,
        queue,
        [RunTaskSpec(id="rt-extra", title="Extra", type=RunTaskType.LLM_CALL)],
    )
    assert len(plan.tasks) == before + 1
    assert plan.tasks[-1].type == RunTaskType.LLM_STREAM
    assert all(t.total == len(plan.tasks) for t in plan.tasks)
