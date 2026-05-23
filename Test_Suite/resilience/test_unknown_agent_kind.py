"""
Unknown agent_kind must return failed AgentResult — never raise — so that
planner-generated tasks referencing a typo or de-registered agent degrade
gracefully instead of crashing the run.
"""

from __future__ import annotations

import pytest

from Test_Suite.mocks.mock_core import MockCore


@pytest.mark.asyncio
async def test_unknown_agent_kind_returns_failed_result() -> None:
    core = MockCore()
    result = await core.run_agent(agent_kind="totally_not_registered_xyz")
    assert result.success is False
    assert "unknown_agent_kind" in (result.error or "")


@pytest.mark.asyncio
async def test_missing_agent_kind_returns_failed_result() -> None:
    """When run_task.agent_kind is empty string, registry must short-circuit."""
    core = MockCore()
    # agent_kind defaults to None in RunTaskSpec — dispatcher returns missing_agent_kind
    result = await core.run_agent(agent_kind="")
    assert result.success is False
    assert "missing_agent_kind" in (result.error or "")
