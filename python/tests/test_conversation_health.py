"""Tests for conversation thread health (P1-1 / P1-2)."""

from oaao_orchestrator.evaluation.conversation_health import (
    analyze_conversation_health,
    is_user_correction,
    topic_shift_flag,
    TurnScorePoint,
)


def test_user_correction_detects_chinese():
    assert is_user_correction("請把費用結構部分補完")
    assert is_user_correction("不对，我说的是合约期限")


def test_topic_shift_low_alignment():
    assert topic_shift_flag(user_message="总结", accs_factors={"alignment": 0.4}, accs_score=0.7) == 1


def test_topic_shift_correction_and_low_accs():
    assert (
        topic_shift_flag(
            user_message="不对，你理解错了",
            accs_factors={"alignment": 0.6},
            accs_score=0.55,
        )
        == 1
    )


def test_health_misunderstanding_loop():
    turns = [
        TurnScorePoint(1, iqs=0.8, accs=0.75, user_message="总结合同"),
        TurnScorePoint(2, iqs=0.7, accs=0.58, topic_shift=1, user_message="请把费用部分补完"),
        TurnScorePoint(3, iqs=0.65, accs=0.52, topic_shift=1, user_message="不对，我问的是终止条款"),
    ]
    h = analyze_conversation_health(111, turns)
    assert h.trend in ("declining", "stable")
    assert "misunderstanding_loop" in h.alerts or h.consecutive_low_accs >= 2


def test_health_improving_trend():
    turns = [
        TurnScorePoint(1, accs=0.55),
        TurnScorePoint(2, accs=0.72),
    ]
    h = analyze_conversation_health(1, turns)
    assert h.trend == "improving"
    assert h.alert == "none"


def test_alignment_declining_not_fired_on_high_rolling_p50():
    """Single-turn drop from 0.90 → 0.72 should not warn when rolling p50 stays healthy."""
    turns = [
        TurnScorePoint(1, accs=0.92),
        TurnScorePoint(2, accs=0.90),
        TurnScorePoint(3, accs=0.72),
    ]
    h = analyze_conversation_health(1, turns)
    assert h.accs_rolling_p50 >= 0.65
    assert "alignment_declining" not in h.alerts
