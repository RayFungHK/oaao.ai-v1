"""UX-1-S11 — feedback judge heuristic."""

from oaao_orchestrator.personalization_feedback_judge import run_feedback_judge


def test_feedback_judge_returns_suggestions() -> None:
    out = run_feedback_judge({"locale": "en", "message_id": 1})
    assert out["auto_apply"] is False
    assert out["source"] == "heuristic_v1"
    assert len(out["suggestions"]) >= 1
    assert "temperature" in out["suggestions"][0]["param"]


def test_feedback_judge_zh() -> None:
    out = run_feedback_judge({"locale": "zh-Hant"})
    assert "temperature" in out["summary"] or "建議" in out["summary"]
