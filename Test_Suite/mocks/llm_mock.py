"""
Thin re-export over the canonical mock at ``python/tests/support/llm_mock.py``.

Reason: avoid duplicating LLM mock logic between Test_Suite and python/tests.
Black-box callers should depend on this module name; underlying impl can move.
"""

from __future__ import annotations

from tests.support.llm_mock import (  # noqa: F401
    LlmMock,
    LlmMockResponse,
    planner_returns_single_llm_task,
)
