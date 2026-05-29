import asyncio

from oaao_orchestrator.evaluation.todo_item_candidate import (
    classify_todo_item_candidate,
    classify_todo_item_candidates,
)


def test_classify_todo_from_checkbox():
    messages = [{"role": "user", "content": "Please handle these items:"}]
    assistant = "- [ ] Send the quarterly report to finance by Friday"
    cand = classify_todo_item_candidate(
        conversation_id=3,
        messages=messages,
        assistant_text=assistant,
    )
    assert cand is not None
    assert "report" in cand.title.lower()
    assert cand.conversation_id == 3


def test_classify_todo_rejects_small_talk():
    cand = classify_todo_item_candidate(
        conversation_id=1,
        messages=[{"role": "user", "content": "Hi"}],
        assistant_text="Hello! How can I help?",
    )
    assert cand is None


def test_classify_todo_skips_duplicate_open_item():
    cand = classify_todo_item_candidate(
        conversation_id=5,
        messages=[{"role": "user", "content": "Please send the Q2 report to finance by Friday."}],
        assistant_text="I will draft the report. You should email finance by end of week.",
        open_todo_items=[{"todo_id": 1, "title": "Send Q2 report to finance"}],
    )
    assert cand is None


def test_heuristic_splits_chinese_todo_list():
    messages = [
        {
            "role": "user",
            "content": "幫我建立一個待辦清單，包含：整理數據、撰寫初稿、寄給主管審閱",
        },
    ]
    assistant = "好的，以下是待辦清單：整理數據、撰寫初稿、寄給主管審閱。"
    items = asyncio.run(
        classify_todo_item_candidates(
            conversation_id=7,
            messages=messages,
            assistant_text=assistant,
            llm_cfg=None,
            chat_request=None,
        )
    )
    assert len(items) >= 3
    titles = {c.title for c in items}
    assert any("整理" in t for t in titles)
    assert any("初稿" in t for t in titles)
    assert any("主管" in t for t in titles)
