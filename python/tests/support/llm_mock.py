"""
Reusable LLM / planner mocks for pytest.

Use with unittest.mock.patch on oaao_orchestrator.planner or HTTP clients.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class LlmMockResponse:
    """Minimal stand-in for an LLM completion."""

    text: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=dict)


class LlmMock:
    """Records prompts and returns canned responses in order."""

    def __init__(self, responses: list[LlmMockResponse] | None = None) -> None:
        self._responses = list(responses or [])
        self._index = 0
        self.prompts: list[list[dict[str, Any]]] = []

    def push(self, response: LlmMockResponse) -> None:
        self._responses.append(response)

    async def complete(
        self,
        messages: list[dict[str, Any]],
        **_: Any,
    ) -> LlmMockResponse:
        self.prompts.append(list(messages))
        if self._index >= len(self._responses):
            return LlmMockResponse(text="[llm_mock: no more responses]")
        out = self._responses[self._index]
        self._index += 1
        return out

    def as_async_callable(self) -> Callable[..., Any]:
        async def _fn(messages: list[dict[str, Any]], **kwargs: Any) -> LlmMockResponse:
            return await self.complete(messages, **kwargs)

        return _fn


def planner_returns_single_llm_task() -> dict[str, Any]:
    """Minimal planner JSON shape for fast-path style tests."""
    return {
        "tasks": [
            {
                "id": "rt-1",
                "title": "Reply",
                "type": "llm_stream",
                "agent_kind": None,
            },
        ],
    }
