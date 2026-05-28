"""WS-1-S11 — merge batch signals into platform orientation."""

from __future__ import annotations

import json
from pathlib import Path

from oaao_orchestrator.knowledge.conversation_signals import merge_conversation_signal_batch
from oaao_orchestrator.knowledge.orientation_store import load_orientation_platform


def test_merge_conversation_signal_batch(tmp_path, monkeypatch) -> None:
    store = tmp_path / "orientation"
    store.mkdir()
    monkeypatch.setenv("OAAO_KNOWLEDGE_ORIENTATION_STORE_DIR", str(store))

    out = merge_conversation_signal_batch(
        [
            {
                "topic_key": "eu-ai-act",
                "label": "EU AI Act compliance",
                "conversation_mentions": 4,
                "keyword_hits": 9,
                "importance_score": 0.72,
            },
        ],
        lookback_days=7,
    )
    assert out["ok"] is True
    assert out["updated"] == 1

    orient = load_orientation_platform()
    assert orient is not None
    assert "eu-ai-act" in orient.topic_signals
    raw_path = store / "platform.json"
    assert raw_path.is_file()
    payload = json.loads(raw_path.read_text(encoding="utf-8"))
    assert "EU AI Act" in " ".join(payload.get("topics") or [])
