"""Per-turn agent intent hook — ``planning.intent`` command template before task planner."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

from oaao_orchestrator.prompt_template import (
    command_template_ref,
    load_template_body,
    prompt_config_from_purpose_payload,
    render_template_text,
)

logger = logging.getLogger(__name__)

DEFAULT_INTENT_TEMPLATE_REF = "materials/prompts/planning/turn_agent_intent.md"
DEFAULT_WEB_THRESHOLD = 0.65


def _attach_turn_intent(req: object, payload: dict[str, Any]) -> None:
    """Store hook output on the run request (Pydantic rejects setattr on undeclared fields)."""
    fields = getattr(type(req), "model_fields", None)
    if fields is not None and "turn_intent" in fields:
        req.turn_intent = payload  # type: ignore[attr-defined]
        return
    setattr(req, "turn_intent", payload)


def _last_user_message(messages: list[dict[str, Any]]) -> str:
    for row in reversed(messages):
        if not isinstance(row, dict):
            continue
        if str(row.get("role") or "").lower() != "user":
            continue
        content = row.get("content")
        if isinstance(content, str):
            return content.strip()
    return ""


@dataclass(frozen=True)
class TurnIntentSignals:
    needs_web_search: bool
    analysis: dict[str, float]


def _web_threshold() -> float:
    try:
        return max(0.0, min(1.0, float(os.environ.get("OAAO_TURN_INTENT_WEB_THRESHOLD", str(DEFAULT_WEB_THRESHOLD)))))
    except (TypeError, ValueError):
        return DEFAULT_WEB_THRESHOLD


def _coerce_score(raw: Any) -> float:
    try:
        return max(0.0, min(1.0, float(raw)))
    except (TypeError, ValueError):
        return 0.0


def parse_turn_intent_response(text: str) -> TurnIntentSignals | None:
    from oaao_orchestrator.json_utils import extract_json_object

    obj = extract_json_object(text)
    if not obj:
        return None
    analysis_raw = obj.get("analysis")
    if not isinstance(analysis_raw, dict):
        return None
    analysis: dict[str, float] = {}
    for key, val in analysis_raw.items():
        if not isinstance(key, str):
            continue
        analysis[key.strip()] = _coerce_score(val)
    web = analysis.get("web_search", 0.0)
    return TurnIntentSignals(
        needs_web_search=web >= _web_threshold(),
        analysis=analysis,
    )


def render_turn_intent_prompt(*, user_input: str, template_ref: str = "") -> str:
    ref = command_template_ref(
        None,
        env_key="OAAO_TURN_INTENT_TEMPLATE_REF",
        default_ref=template_ref or DEFAULT_INTENT_TEMPLATE_REF,
    )
    body = load_template_body(ref=ref, fallback="")
    if not body:
        logger.warning("turn_intent template missing ref=%s", ref)
        return ""
    quoted = (user_input or "").strip().replace('"', '\\"')
    return render_template_text(body, {"user_input": quoted})


async def score_turn_intent(
    req: object,
    *,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
) -> TurnIntentSignals | None:
    """Score agent intent from ``req.planner_intent`` (or ``req.planner`` fallback) + command template."""
    intent_payload = getattr(req, "planner_intent", None)
    if not isinstance(intent_payload, dict):
        intent_payload = getattr(req, "planner", None)
    if not isinstance(intent_payload, dict):
        return None
    if not str(intent_payload.get("base_url") or "").strip() or not str(intent_payload.get("model") or "").strip():
        return None

    user_msg = _last_user_message(getattr(req, "messages", []) or [])
    if not user_msg:
        return None

    prompt_cfg = prompt_config_from_purpose_payload(intent_payload)
    template_ref = command_template_ref(
        prompt_cfg,
        env_key="OAAO_TURN_INTENT_TEMPLATE_REF",
        default_ref=DEFAULT_INTENT_TEMPLATE_REF,
    )
    rendered = render_turn_intent_prompt(user_input=user_msg, template_ref=template_ref)
    if not rendered:
        return None

    from oaao_orchestrator.planner_llm import llm_chat_completion_text

    text = await llm_chat_completion_text(
        url=chat_completions_url,
        api_key=api_key,
        model=model,
        messages=[{"role": "user", "content": rendered}],
        temperature=0.0,
    )
    if not text:
        return None
    signals = parse_turn_intent_response(text)
    if signals is None:
        logger.warning("turn_intent_json_parse_failed")
    return signals


async def apply_turn_intent_hook(
    req: object,
    *,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
) -> None:
    """Run intent hook and store signals on ``req.turn_intent`` for planner + injection."""
    if bool(getattr(req, "enable_web_search", False)):
        _attach_turn_intent(
            req,
            {"needs_web_search": True, "analysis": {"web_search": 1.0}},
        )
        return
    intent_payload = getattr(req, "planner_intent", None)
    if not isinstance(intent_payload, dict):
        intent_payload = getattr(req, "planner", None)
    if not isinstance(intent_payload, dict):
        return
    base = str(intent_payload.get("base_url") or "").strip()
    mdl = str(intent_payload.get("model") or "").strip()
    if not base or not mdl:
        return
    try:
        signals = await score_turn_intent(
            req,
            chat_completions_url=chat_completions_url,
            api_key=api_key,
            model=mdl,
        )
    except Exception:
        logger.exception("turn_intent_hook_failed")
        return
    if signals is None:
        return
    _attach_turn_intent(
        req,
        {
            "needs_web_search": signals.needs_web_search,
            "analysis": signals.analysis,
        },
    )
    logger.info(
        "turn_intent_scored web_search=%.2f needs_web=%s",
        signals.analysis.get("web_search", 0.0),
        signals.needs_web_search,
    )
