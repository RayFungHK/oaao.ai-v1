"""Fork chat suggestion helpers."""

from __future__ import annotations

import pytest

from oaao_orchestrator.evaluation.fork_chat_suggestions import (
    build_fork_chat_suggestions,
    heuristic_fork_suggestions,
)


@pytest.mark.asyncio
async def test_heuristic_fork_suggestions_chinese():
    out = await build_fork_chat_suggestions(
        alert="misunderstanding_loop",
        recent_user_messages=["請把合約備援方案補完"],
        coach_endpoint=None,
    )
    assert out["intro"]
    assert len(out["suggestions"]) >= 2
    assert out["source"] == "heuristic"
    assert any("核心" in s or "需求" in s for s in out["suggestions"])


def test_heuristic_includes_user_snippet():
    items = heuristic_fork_suggestions(
        alert="drift",
        health={},
        recent_user_messages=["Explain contract fallback for vendor exit"],
    )
    assert len(items) >= 2
