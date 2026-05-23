"""
Resilience — a single failing agent must NOT take down the pipeline.

Current contract (documented in `python/tests/test_pipeline_hook_resilience.py`):
- `AgentRegistry.run()` propagates exceptions from known agents.
- The executor layer (run_executor.py) MUST catch and convert to FAILED status.

These tests freeze that contract from the Test_Suite (black-box) perspective and
verify the executor-style wrapping pattern works for surrounding code.
"""

from __future__ import annotations

import pytest

from Test_Suite.mocks.mock_core import BoomAgent, MockCore

from oaao_orchestrator.agents.registry import AgentResult


@pytest.mark.asyncio
async def test_registry_propagates_known_agent_exception() -> None:
    """Documents current contract: registry does not catch."""
    core = MockCore()
    core.register(BoomAgent(agent_kind="boom"))
    with pytest.raises(RuntimeError, match="boom"):
        await core.run_agent(agent_kind="boom")


@pytest.mark.asyncio
async def test_executor_pattern_catches_and_returns_failed() -> None:
    """Simulate the run_executor try/except wrapping pattern."""
    core = MockCore()
    core.register(BoomAgent(agent_kind="boom2"))
    try:
        result = await core.run_agent(agent_kind="boom2")
    except Exception as exc:  # noqa: BLE001 — emulating executor catch
        result = AgentResult(success=False, error=f"caught:{type(exc).__name__}")
    assert result.success is False
    assert result.error == "caught:RuntimeError"


@pytest.mark.asyncio
async def test_subsequent_agent_runs_after_failure() -> None:
    """After one agent fails, the next dispatch through the registry must still work."""
    from Test_Suite.mocks.mock_core import StubAgent

    core = MockCore()
    core.register(BoomAgent(agent_kind="boom3"))
    core.register(StubAgent(agent_kind="ok"))

    with pytest.raises(RuntimeError):
        await core.run_agent(agent_kind="boom3")

    ok_result = await core.run_agent(agent_kind="ok", task_id="rt-after")
    assert ok_result.success
