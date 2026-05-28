"""WS-1-S5 — scheduled refresh plan builder."""

from __future__ import annotations

from oaao_orchestrator.knowledge.orientation_models import OrientationJsonV1
from oaao_orchestrator.knowledge.refresh_worker import (
    build_scheduled_search_plan,
    should_refresh_scope,
)
from oaao_orchestrator.knowledge.scope import KnowledgeScopeRef


def test_build_scheduled_search_plan_from_orientation() -> None:
    orient = OrientationJsonV1(
        tenant_id=1,
        search_queries_suggested=["HKMA circular 2026", "Basel III update"],
        do_not_search=["gambling"],
    )
    plan = build_scheduled_search_plan(orient)
    assert plan["method"] == "scheduled_refresh"
    assert len(plan["queries"]) == 2
    assert plan["queries"][0]["reason"] == "scheduled_refresh"


def test_should_refresh_forced() -> None:
    ref = KnowledgeScopeRef(scope="tenant", tenant_id=1)
    ok, reason = should_refresh_scope(ref, force=True)
    assert ok is True
    assert reason == "forced"
