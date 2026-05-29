"""Bubble Chat — persistent agent skip vs productivity post-turn hooks."""

from __future__ import annotations

from types import SimpleNamespace

from oaao_orchestrator.bubble_chat_run import (
    filter_persistent_agents_from_allowed,
    is_bubble_chat,
    should_skip_bubble_ephemeral_hooks,
)
from oaao_orchestrator.chat_models import ChatRunRequest
from oaao_orchestrator.routes._shared_models import EndpointPayload


def _minimal_req(**kwargs: object) -> ChatRunRequest:
    base = {
        "endpoint": EndpointPayload(
            endpoint_ref="test",
            base_url="http://llm",
            model="m",
        ),
    }
    base.update(kwargs)
    return ChatRunRequest(**base)  # type: ignore[arg-type]


def test_is_bubble_by_kind() -> None:
    req = _minimal_req(conversation_kind="bubble")
    assert is_bubble_chat(req) is True
    assert should_skip_bubble_ephemeral_hooks(req) is True


def test_legacy_skip_flag_means_persistent_only() -> None:
    req = _minimal_req(skip_post_turn_agent_hooks=True)
    assert is_bubble_chat(req) is True


def test_filter_removes_slide_designer() -> None:
    out = filter_persistent_agents_from_allowed(
        ["web_search", "slide_designer", "sandbox_code"],
    )
    assert out == ["web_search", "sandbox_code"]


def test_normal_chat_not_bubble() -> None:
    req = _minimal_req(conversation_kind="thread")
    assert is_bubble_chat(req) is False
