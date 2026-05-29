from oaao_orchestrator.evaluation.todo_item_candidate import classify_todo_item_candidate


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
