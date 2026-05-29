"""UX-1-S5 preference tags + instruction mapping."""

from oaao_orchestrator.preference_profile import (
    align_guided_option_id,
    derive_preference_profile_from_guided,
    preference_style_planner_append,
)
def test_align_guided_option_id_from_fallback_index() -> None:
    fb = [
        {"id": "q2_balanced", "label": "平衡"},
        {"id": "q2_creative", "label": "較有創意"},
    ]
    assert align_guided_option_id("opt_1", label="平衡", step_index=1, option_index=0, fallback_options=fb) == "q2_balanced"


def test_derive_preference_profile_zh() -> None:
    answers = [
        {"id": "q1_concise", "step_index": 0},
        {"id": "q2_factual", "step_index": 1},
        {"id": "q5_steady", "step_index": 4},
    ]
    prof = derive_preference_profile_from_guided(answers, locale="zh-Hant")
    assert "#簡潔" in prof["preference_tags"]
    assert prof["preference_system_instruction"]
    assert "簡潔" in prof["preference_tags_summary"]


def test_planner_append_from_personalization() -> None:
    block = preference_style_planner_append(
        {
            "preference_style_instruction": "Keep replies concise.",
            "preference_tags": ["#concise"],
        },
    )
    assert "Chat style profile" in block
    assert "concise" in block

