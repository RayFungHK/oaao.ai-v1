"""Web search agent must use the shared AgentSpec / emit contract."""

from __future__ import annotations

from oaao_orchestrator.tasks.models import AgentSpec, AgentStatus, AgentTaskSpec


def test_agent_spec_requires_run_task_id() -> None:
    spec = AgentSpec(
        id="ag-rt-web-search",
        run_task_id="rt-web-search",
        kind="web_search",
        status=AgentStatus.RUNNING,
    )
    assert spec.run_task_id == "rt-web-search"


def test_agent_task_spec_requires_agent_and_run_task_ids() -> None:
    task = AgentTaskSpec(
        id="at-rt-web-search-p",
        title="Build search plan",
        agent_id="ag-rt-web-search",
        run_task_id="rt-web-search",
        index=1,
        total=4,
    )
    assert task.agent_id == "ag-rt-web-search"
