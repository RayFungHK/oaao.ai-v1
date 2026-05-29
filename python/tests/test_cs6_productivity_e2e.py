"""CS-6-S9 — todo candidate → suggested payload shape."""

from oaao_orchestrator.evaluation.todo_item_candidate import classify_todo_item_candidate


def test_todo_candidate_emits_actionable_title() -> None:
    messages = [
        {"role": "user", "content": "Please send the Q2 report to finance by Friday."},
        {
            "role": "assistant",
            "content": "I will draft the report. You should email finance by end of week.",
        },
    ]
    assistant_text = messages[-1]["content"]
    cand = classify_todo_item_candidate(
        conversation_id=1,
        messages=messages,
        assistant_text=assistant_text,
    )
    assert cand is not None
    assert cand.confidence > 0
    assert cand.title.strip() != ""
