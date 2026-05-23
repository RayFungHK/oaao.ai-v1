"""
Two-box failover contract — Phase 10 implementation must satisfy.

Spec source: docs/Audit_Report.md §7.2, docs/Evolution_System_Design.md §3
"""

from __future__ import annotations

import pytest

ep = pytest.importorskip(
    "oaao_orchestrator.endpoint",
    reason="endpoint module must exist (Phase 10 extends it)",
)


def _has(fn_name: str) -> bool:
    return hasattr(ep, fn_name)


@pytest.mark.skipif(not _has("pick_base_url"), reason="Phase 10 — pick_base_url not yet added")
def test_pick_base_url_round_robin() -> None:
    cfg = {
        "base_urls": ["http://box1:9000", "http://box2:9000"],
        "routing_policy": "round_robin",
    }
    picks = [ep.pick_base_url(cfg, ctx=None) for _ in range(4)]
    # round_robin → equal split
    assert picks.count("http://box1:9000") == 2
    assert picks.count("http://box2:9000") == 2


@pytest.mark.skipif(not _has("pick_base_url"), reason="Phase 10 — pick_base_url not yet added")
def test_pick_base_url_tiered_by_mode() -> None:
    """mode_id ∈ {tot, ddtree} → Box 1; else → Box 2."""

    class Ctx:
        def __init__(self, mode_id: str, purpose_id: str = "chat"):
            self.mode_id = mode_id
            self.purpose_id = purpose_id

    cfg = {
        "base_urls": ["http://box1:9000", "http://box2:9000"],
        "routing_policy": "tiered",
    }
    assert ep.pick_base_url(cfg, ctx=Ctx("tot")) == "http://box1:9000"
    assert ep.pick_base_url(cfg, ctx=Ctx("ddtree")) == "http://box1:9000"
    assert ep.pick_base_url(cfg, ctx=Ctx("default")) == "http://box2:9000"


@pytest.mark.skipif(not _has("pick_base_url"), reason="Phase 10 — pick_base_url not yet added")
def test_pick_base_url_falls_back_when_box_unhealthy(monkeypatch) -> None:
    """When tiered choice is unhealthy, fall back to the other Box."""
    health = {"http://box1:9000": False, "http://box2:9000": True}
    monkeypatch.setattr(ep, "_is_healthy", lambda url: health.get(url, False))

    class Ctx:
        mode_id = "tot"
        purpose_id = "chat"

    cfg = {
        "base_urls": ["http://box1:9000", "http://box2:9000"],
        "routing_policy": "tiered",
    }
    picked = ep.pick_base_url(cfg, ctx=Ctx())
    assert picked == "http://box2:9000"


@pytest.mark.skipif(not _has("pick_base_url"), reason="Phase 10 — pick_base_url not yet added")
def test_pick_base_url_legacy_single_base_url_still_works() -> None:
    """Old purpose configs (single base_url) must keep working unchanged."""
    cfg = {"base_url": "http://legacy:9000"}
    assert ep.pick_base_url(cfg, ctx=None) == "http://legacy:9000"


@pytest.mark.skipif(not _has("pick_base_url"), reason="Phase 10 — pick_base_url not yet added")
def test_asr_purpose_pinned_to_box2() -> None:
    """purpose_id ∈ {asr, voice_chat} must always pick Box 2."""

    class Ctx:
        mode_id = "tot"   # even with heavy mode
        purpose_id = "asr"

    cfg = {
        "base_urls": ["http://box1:9000", "http://box2:9000"],
        "routing_policy": "tiered",
    }
    assert ep.pick_base_url(cfg, ctx=Ctx()) == "http://box2:9000"
