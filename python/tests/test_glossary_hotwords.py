from __future__ import annotations

from oaao_orchestrator.live_meeting.glossary_hotwords import (
    hotwords_from_glossary,
    hotwords_json_for_dashscope,
)


def test_hotwords_from_glossary() -> None:
    glossary = {
        "terms": [
            {"term": "OAAO"},
            {"term": "錢包"},
            {"term": "OAAO"},
        ],
    }
    words = hotwords_from_glossary(glossary)
    assert words == ["OAAO", "錢包"]
    j = hotwords_json_for_dashscope(glossary)
    assert j is not None and "OAAO" in j
