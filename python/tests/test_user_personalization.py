"""Tests for user personalization system block."""

from __future__ import annotations

from oaao_orchestrator.user_personalization import (
    UserPersonalizationPayload,
    apply_user_personalization,
    build_user_personalization_system_block,
)


def test_build_block_profile_and_knowledge() -> None:
    block = build_user_personalization_system_block(
        UserPersonalizationPayload(
            nickname="Ray",
            occupation="Analyst",
            about_you="Works in React and SQL.",
            custom_instructions="Be concise.",
            knowledge="Prefers metric units.",
            timezone="Asia/Hong_Kong",
            region="Hong Kong",
        )
    )
    assert block is not None
    assert "Ray" in block
    assert "Analyst" in block
    assert "React and SQL" in block
    assert "Be concise" in block
    assert "metric units" in block
    assert "Hong Kong" in block
    assert "Current local date and time" in block


def test_build_block_datetime_only_when_profile_disabled() -> None:
    block = build_user_personalization_system_block(
        UserPersonalizationPayload(
            use_profile_in_chat=False,
            use_knowledge_in_chat=False,
            include_datetime_in_chat=True,
            timezone="UTC",
            region="NYC",
        )
    )
    assert block is not None
    assert "User profile" not in block
    assert "User knowledge" not in block
    assert "NYC" in block
    assert "Current local date and time" in block


def test_build_block_empty_returns_none() -> None:
    assert build_user_personalization_system_block(None) is None
    assert (
        build_user_personalization_system_block(
            UserPersonalizationPayload(
                use_profile_in_chat=False,
                use_knowledge_in_chat=False,
                include_datetime_in_chat=False,
            )
        )
        is None
    )


def test_apply_user_personalization_merges_system() -> None:
    class Req:
        user_personalization = {
            "nickname": "Jane",
            "timezone": "UTC",
            "include_datetime_in_chat": True,
            "use_profile_in_chat": True,
            "use_knowledge_in_chat": False,
        }

    messages = [{"role": "user", "content": "Hi"}]
    apply_user_personalization(req=Req(), messages_for_llm=messages)
    assert messages[0]["role"] == "system"
    assert "Jane" in messages[0]["content"]
