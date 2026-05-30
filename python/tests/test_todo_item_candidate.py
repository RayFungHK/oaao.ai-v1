"""CS-6 — todo post-turn LLM hook (JSON actions)."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, patch

from oaao_orchestrator.evaluation.todo_item_candidate import (
    TodoItemCandidate,
    classify_todo_item_candidate,
    classify_todo_item_candidates,
)


def _llm_json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def test_classify_todo_from_llm_checkbox_action() -> None:
    messages = [{"role": "user", "content": "Please handle these items:"}]
    assistant = "- [ ] Send the quarterly report to finance by Friday"
    llm_out = _llm_json(
        {
            "actions": [
                {
                    "type": "todo_item_suggested",
                    "title": "Send the quarterly report to finance",
                    "confidence": 0.85,
                }
            ]
        }
    )
    llm_cfg = {"base_url": "http://llm", "model": "m", "api_key": "k"}

    with patch(
        "oaao_orchestrator.evaluation.todo_item_candidate.chat_completion_text",
        new_callable=AsyncMock,
        return_value=llm_out,
    ):
        cand = classify_todo_item_candidate(
            conversation_id=3,
            messages=messages,
            assistant_text=assistant,
            llm_cfg=llm_cfg,
        )

    assert cand is not None
    assert "report" in cand.title.lower()
    assert cand.conversation_id == 3


def test_classify_todo_rejects_small_talk() -> None:
    with patch(
        "oaao_orchestrator.evaluation.todo_item_candidate.chat_completion_text",
        new_callable=AsyncMock,
    ) as mock_llm:
        cand = classify_todo_item_candidate(
            conversation_id=1,
            messages=[{"role": "user", "content": "Hi"}],
            assistant_text="Hello!",
            llm_cfg={"base_url": "http://llm", "model": "m", "api_key": "k"},
        )
    assert cand is None
    mock_llm.assert_not_called()


def test_classify_todo_skips_duplicate_open_item() -> None:
    llm_out = _llm_json(
        {
            "actions": [
                {
                    "type": "todo_item_suggested",
                    "title": "Send Q2 report to finance",
                    "confidence": 0.9,
                }
            ]
        }
    )
    with patch(
        "oaao_orchestrator.evaluation.todo_item_candidate.chat_completion_text",
        new_callable=AsyncMock,
        return_value=llm_out,
    ):
        cand = classify_todo_item_candidate(
            conversation_id=5,
            messages=[{"role": "user", "content": "Please send the Q2 report to finance by Friday."}],
            assistant_text="I will draft the report. You should email finance by end of week.",
            open_todo_items=[{"todo_id": 1, "title": "Send Q2 report to finance"}],
            llm_cfg={"base_url": "http://llm", "model": "m", "api_key": "k"},
        )
    assert cand is None


def test_llm_splits_chinese_todo_list() -> None:
    messages = [
        {
            "role": "user",
            "content": "幫我建立一個待辦清單，包含：整理數據、撰寫初稿、寄給主管審閱",
        },
    ]
    assistant = "好的，以下是待辦清單：整理數據、撰寫初稿、寄給主管審閱。"
    llm_out = _llm_json(
        {
            "actions": [
                {"type": "todo_item_suggested", "title": "整理數據", "confidence": 0.9},
                {"type": "todo_item_suggested", "title": "撰寫初稿", "confidence": 0.88},
                {"type": "todo_item_suggested", "title": "寄給主管審閱", "confidence": 0.86},
            ]
        }
    )
    with patch(
        "oaao_orchestrator.evaluation.todo_item_candidate.chat_completion_text",
        new_callable=AsyncMock,
        return_value=llm_out,
    ):
        items = asyncio.run(
            classify_todo_item_candidates(
                conversation_id=7,
                messages=messages,
                assistant_text=assistant,
                llm_cfg={"base_url": "http://llm", "model": "m", "api_key": "k"},
            )
        )
    assert len(items) >= 3
    titles = {c.title for c in items}
    assert any("整理" in t for t in titles)
    assert any("初稿" in t for t in titles)
    assert any("主管" in t for t in titles)
    assert all(isinstance(c, TodoItemCandidate) for c in items)
