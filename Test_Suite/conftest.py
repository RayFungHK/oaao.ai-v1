"""
Shared fixtures for Test_Suite (black-box / CLI layer).

- Auto-adds `python/` to sys.path so `import oaao_orchestrator.*` works without install.
- Resets the agent registry between tests to keep tests independent.
- Provides a `stream_run` fixture and a `mock_llm` fixture.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent
_REPO_PY = _REPO_ROOT / "python"
# `_REPO_ROOT` so `import Test_Suite.mocks…` works; `_REPO_PY` so `import oaao_orchestrator…` works.
for _p in (_REPO_ROOT, _REPO_PY):
    _sp = str(_p)
    if _sp not in sys.path:
        sys.path.insert(0, _sp)


@pytest.fixture(autouse=True)
def _reset_agent_registry():
    """Reset agent registry singleton before each test (no cross-test leakage)."""
    from oaao_orchestrator.agents.registry import reset_agent_registry_for_tests

    reset_agent_registry_for_tests()
    yield
    reset_agent_registry_for_tests()


@pytest.fixture
def stream_run():
    """Fresh StreamRun harness — capture all envelopes via `.events`."""
    from oaao_orchestrator.streaming.session import StreamRun

    return StreamRun("test-suite-run")


@pytest.fixture
def run_ctx():
    """Default empty RunContext."""
    from oaao_orchestrator.pipeline import RunContext

    return RunContext(
        conversation_id="conv-test",
        user_id="user-test",
        purpose_id="default_chat",
        mode_id="default",
        messages=[{"role": "user", "content": "hello"}],
    )


@pytest.fixture
def mock_llm():
    """Reusable LlmMock instance (delegates to python/tests/support)."""
    from tests.support.llm_mock import LlmMock

    return LlmMock()
