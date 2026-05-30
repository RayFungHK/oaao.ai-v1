"""Tests for strip_hash and strip_items builders."""

from __future__ import annotations

import pytest

from oaao_orchestrator.evaluation.strip_items import build_strip_stage_payload
from oaao_orchestrator.strip_hash import issue_strip_hash, payload_digest


@pytest.fixture(autouse=True)
def _secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OAAO_ORCH_SHARED_SECRET", "test-strip-secret")


def test_issue_strip_hash_format() -> None:
    token = issue_strip_hash(
        user_id=1,
        conversation_id=10,
        message_id=20,
        action_id="calendar_event_suggested",
        payload={"title": "Sync", "start_at": "2026-05-30T10:00:00+08:00"},
    )
    assert token.startswith("v1.")
    parts = token.split(".")
    assert len(parts) == 3


def test_build_strip_stage_payload_items() -> None:
    body = build_strip_stage_payload(
        {
            "calendar_event_suggested": {
                "title": "Team sync",
                "start_at": "2026-05-30T10:00:00+08:00",
            },
            "todo_items_suggested": [
                {"title": "A", "context_snippet": "x"},
                {"title": "B", "context_snippet": "y"},
            ],
        },
        user_id=5,
        conversation_id=99,
        message_id=100,
    )
    assert body["area"] == "strip"
    items = body["items"]
    assert len(items) == 2
    assert all(str(row.get("strip_hash", "")).startswith("v1.") for row in items)
    assert items[0]["action_id"] == "calendar_event_suggested"
    assert items[0]["confirmation"] is True
    assert "message" in items[0]
    assert items[1]["action_id"] == "todo_items_suggested"
    assert items[1]["payload"] == {
        "items": [
            {"title": "A", "context_snippet": "x"},
            {"title": "B", "context_snippet": "y"},
        ]
    }


def test_payload_digest_stable() -> None:
    d1 = payload_digest({"a": 1, "b": 2})
    d2 = payload_digest({"b": 2, "a": 1})
    assert d1 == d2
