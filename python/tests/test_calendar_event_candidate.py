"""CS-5 — calendar post-turn LLM hook (JSON actions)."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, patch

from oaao_orchestrator.evaluation.calendar_event_candidate import (
    CalendarEventCandidate,
    classify_calendar_event_candidate,
)


def _llm_json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def test_calendar_candidate_from_llm_action() -> None:
    messages = [
        {
            "role": "user",
            "content": "Schedule a team meeting on 2026-06-15 at 14:00 location: Room 3A",
        },
    ]
    assistant = (
        "Confirmed — I'll block 2026-06-15 at 14:00 for the team meeting in Room 3A."
    )
    llm_out = _llm_json(
        {
            "actions": [
                {
                    "type": "calendar_event_suggested",
                    "title": "Team meeting",
                    "start_at": "2026-06-15T14:00:00Z",
                    "end_at": "2026-06-15T15:00:00Z",
                    "all_day": False,
                    "timezone": "UTC",
                    "location": "Room 3A",
                    "notes": "Team meeting",
                    "confidence": 0.88,
                }
            ]
        }
    )
    llm_cfg = {"base_url": "http://llm", "model": "m", "api_key": "k"}

    with patch(
        "oaao_orchestrator.evaluation.calendar_event_candidate.chat_completion_text",
        new_callable=AsyncMock,
        return_value=llm_out,
    ):
        cand = asyncio.run(
            classify_calendar_event_candidate(
                conversation_id=9,
                messages=messages,
                assistant_text=assistant,
                llm_cfg=llm_cfg,
            )
        )

    assert isinstance(cand, CalendarEventCandidate)
    assert cand.conversation_id == 9
    assert "2026" in cand.start_at
    assert cand.location == "Room 3A"


def test_calendar_rejects_vault_meta_without_llm_call() -> None:
    with patch(
        "oaao_orchestrator.evaluation.calendar_event_candidate.chat_completion_text",
        new_callable=AsyncMock,
    ) as mock_llm:
        cand = asyncio.run(
            classify_calendar_event_candidate(
                conversation_id=1,
                messages=[{"role": "user", "content": "Meet tomorrow at 3pm"}],
                assistant_text="This turn scoped or ran a knowledge-base (Vault) search.",
                llm_cfg={"base_url": "http://llm", "model": "m", "api_key": "k"},
            )
        )
    assert cand is None
    mock_llm.assert_not_called()


def test_calendar_empty_actions_returns_none() -> None:
    llm_cfg = {"base_url": "http://llm", "model": "m", "api_key": "k"}
    with patch(
        "oaao_orchestrator.evaluation.calendar_event_candidate.chat_completion_text",
        new_callable=AsyncMock,
        return_value='{"actions": []}',
    ):
        cand = asyncio.run(
            classify_calendar_event_candidate(
                conversation_id=1,
                messages=[{"role": "user", "content": "What is RAG?"}],
                assistant_text="RAG retrieves documents from a vector store.",
                llm_cfg=llm_cfg,
            )
        )
    assert cand is None
