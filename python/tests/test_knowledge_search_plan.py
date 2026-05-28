"""WS-1-S3 — search plan stub fallback."""

from __future__ import annotations

import asyncio

from oaao_orchestrator.knowledge.orientation_models import OrientationJsonV1
from oaao_orchestrator.knowledge.search_plan import _fallback_queries, build_search_plan


def test_fallback_queries_orientation_first() -> None:
    orient = OrientationJsonV1(
        workspace_id=1,
        search_queries_suggested=["HKGX regulatory update 2026"],
    )
    rows = _fallback_queries(user_query="user question", orientation=orient, max_queries=2)
    assert rows[0]["q"] == "HKGX regulatory update 2026"
    assert rows[0]["reason"] == "orientation_suggested"


async def test_build_search_plan_stub_without_llm() -> None:
    plan = await build_search_plan(
        tenant_id=None,
        workspace_id=None,
        messages=[{"role": "user", "content": "Latest CGSE notice format"}],
        knowledge=None,
    )
    assert plan["version"] == 1
    assert plan["method"] == "stub_fallback"
    assert len(plan["queries"]) >= 1
    assert plan["queries"][0]["q"]


def test_build_search_plan_sync_entry() -> None:
    asyncio.run(test_build_search_plan_stub_without_llm())
