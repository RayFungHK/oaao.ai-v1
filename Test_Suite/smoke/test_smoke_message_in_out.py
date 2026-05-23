"""
Smoke test — Message In → Hook Chain → Response Out without UI / HTTP.

This is the pytest counterpart of `cli_smoke.py`; CI runs it headless.
"""

from __future__ import annotations

import pytest

from Test_Suite.smoke.cli_smoke import EchoAgent
from Test_Suite.mocks.mock_core import MockCore

from oaao_orchestrator.agents.registry import register_agent
from oaao_orchestrator.pipeline import RunContext


@pytest.mark.asyncio
async def test_smoke_message_in_response_out() -> None:
    register_agent(EchoAgent())
    core = MockCore()
    ctx = RunContext(messages=[{"role": "user", "content": "ping"}])

    result = await core.run_agent(agent_kind="echo", task_id="rt-smoke", ctx=ctx)

    assert result.success, result.error
    assert "ping" in (result.extra.get("reply") or "")

    start = [e for e in core.envelopes if e.kind == "start"]
    end = [e for e in core.envelopes if e.kind == "end"]
    assert len(start) == 1 and start[0].step_id == "rt-smoke"
    assert len(end) == 1 and "reply" in end[0].payload
