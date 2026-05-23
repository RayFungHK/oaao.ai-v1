from __future__ import annotations

from oaao_orchestrator.live_meeting.bubble_engine import (
    cadence_interval_sec,
    extract_bubbles,
)


def test_cadence_interval_sec() -> None:
    assert cadence_interval_sec("debate") == 8.0
    assert cadence_interval_sec("meeting") == 60.0
    assert cadence_interval_sec("unknown") == 20.0


def test_extract_bubbles_glossary_keyword() -> None:
    glossary = {"terms": [{"term": "錢包"}, {"term": "API"}]}
    text = "我們今天討論錢包的用法，還有 API 整合。"
    bubbles = extract_bubbles(text, glossary)
    labels = {b["text"] for b in bubbles}
    assert "錢包" in labels


def test_extract_bubbles_question() -> None:
    text = "客戶問我們錢包怎麼充值？另外還有手續費嗎"
    bubbles = extract_bubbles(text, None)
    types = {b["bubble_type"] for b in bubbles}
    assert "question" in types


def test_extract_bubbles_intent_ai_tutorial() -> None:
    text = "我要AI教學"
    bubbles = extract_bubbles(text, None)
    labels = {b["text"] for b in bubbles}
    assert "AI" in labels


def test_extract_bubbles_skips_spoken_digit_numerals() -> None:
    text = "一二三四，聽唔聽到？"
    bubbles = extract_bubbles(text, None)
    labels = {b["text"] for b in bubbles}
    assert "一二三四" not in labels


def test_extract_bubbles_glossary_digits() -> None:
    glossary = {"terms": [{"term": "1234"}]}
    text = "testing 1234 now"
    bubbles = extract_bubbles(text, glossary)
    labels = {b["text"] for b in bubbles}
    assert "1234" in labels
