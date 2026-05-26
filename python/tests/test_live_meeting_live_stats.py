from __future__ import annotations

from pathlib import Path

from oaao_orchestrator.live_meeting.hub import _live_stats_payload, _SessionRuntime
from oaao_orchestrator.live_meeting.session import LiveMeetingSession


def _runtime() -> _SessionRuntime:
    session = LiveMeetingSession(
        session_id="sess-test",
        root=Path("/tmp/oaao-live-test"),
        cadence="1v1",
        retention_mode="disk_ttl",
        workspace_id=1,
        user_id=1,
    )
    return _SessionRuntime(session=session)


def test_live_stats_payload_first_lookup_delta_equals_total() -> None:
    runtime = _runtime()
    out = _live_stats_payload(
        bubble_id="b1",
        evidence_total=3,
        passage_count=12,
        runtime=runtime,
    )
    assert out["evidence_total"] == 3
    assert out["passage_count"] == 12
    assert out["delta"] == 3


def test_live_stats_payload_repeat_lookup_delta_is_zero() -> None:
    runtime = _runtime()
    _live_stats_payload(
        bubble_id="b1",
        evidence_total=3,
        passage_count=12,
        runtime=runtime,
    )
    out = _live_stats_payload(
        bubble_id="b1",
        evidence_total=3,
        passage_count=12,
        runtime=runtime,
    )
    assert out["delta"] == 0


def test_live_stats_payload_more_sources_increments_delta() -> None:
    runtime = _runtime()
    _live_stats_payload(
        bubble_id="b1",
        evidence_total=2,
        passage_count=5,
        runtime=runtime,
    )
    out = _live_stats_payload(
        bubble_id="b1",
        evidence_total=5,
        passage_count=8,
        runtime=runtime,
    )
    assert out["delta"] == 3
