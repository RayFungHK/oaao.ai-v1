"""WS-1-S10 — platform topic scoring and auto-search gates."""

from __future__ import annotations

from oaao_orchestrator.knowledge.orientation_models import OrientationJsonV1
from oaao_orchestrator.knowledge.topic_lifecycle import (
    TopicSignalV1,
    filter_scheduled_queries,
    record_search_outcome,
    should_include_topic_in_auto_search,
    topic_key_from_label,
)


def test_topic_key_normalizes() -> None:
    assert topic_key_from_label("Basel III Update 2026") == "basel-iii-update-2026"


def test_filter_drops_low_importance_tail() -> None:
    orient = OrientationJsonV1(
        scope="platform",
        topics=[f"topic-{i}" for i in range(20)],
        search_queries_suggested=[],
    )
    queries = [{"q": "topic-19 noise", "provider": "searxng"}]
    kept, skipped = filter_scheduled_queries(queries, orient)
    assert kept == []
    assert skipped and skipped[0]["reason"] == "importance_below_gate"


def test_paused_low_yield_blocks_until_breakthrough() -> None:
    key = topic_key_from_label("HKMA circular")
    sig = TopicSignalV1(
        topic_key=key,
        status="paused_low_yield",
        search_runs=5,
        yield_density=0.05,
        last_new_hits=0,
    )
    ok, reason = should_include_topic_in_auto_search(sig, importance=0.9)
    assert ok is False
    assert reason == "paused_low_yield"
    sig.breakthrough_links = ["new-regulation"]
    ok2, reason2 = should_include_topic_in_auto_search(sig, importance=0.9)
    assert ok2 is True
    assert reason2 == "breakthrough_linked"


def test_record_search_outcome_pauses_after_low_yield() -> None:
    orient = OrientationJsonV1(scope="platform", topics=["AI regulation"])
    q = "AI regulation EU 2026"
    for _ in range(4):
        record_search_outcome(orient, query=q, hits_count=0, new_content_ratio=0.0)
    signals = orient.topic_signals
    key = topic_key_from_label(q)
    assert signals[key]["status"] == "paused_low_yield"
