from typing import Any

from pydantic import BaseModel

from oaao_orchestrator.turn_intent import (
    _attach_turn_intent,
    parse_turn_intent_response,
    render_turn_intent_prompt,
)


def test_parse_turn_intent_response_web_search() -> None:
    text = """
    {"analysis": {"web_search": 0.92, "slide_designer": 0.1, "office_generate": 0.0},
     "reasoning": {"web_search": "product launch"}}
    """
    signals = parse_turn_intent_response(text)
    assert signals is not None
    assert signals.needs_web_search is True
    assert signals.analysis["web_search"] == 0.92


def test_parse_turn_intent_low_web_score() -> None:
    text = '{"analysis": {"web_search": 0.2}}'
    signals = parse_turn_intent_response(text)
    assert signals is not None
    assert signals.needs_web_search is False


def test_render_turn_intent_prompt_includes_user_input() -> None:
    msg = render_turn_intent_prompt(user_input="DJI Pocket 4 Pro 開售")
    assert "DJI Pocket 4 Pro" in msg
    assert "web_search" in msg


def test_attach_turn_intent_on_pydantic_request() -> None:
    class _Req(BaseModel):
        turn_intent: dict[str, Any] | None = None

    req = _Req()
    _attach_turn_intent(req, {"needs_web_search": True, "analysis": {"web_search": 0.9}})
    assert req.turn_intent is not None
    assert req.turn_intent["needs_web_search"] is True
