"""Per-turn agent intent hook — ``planning.intent`` command template before task planner."""

from __future__ import annotations

import logging
from typing import Any

from oaao_orchestrator.agent_intent_hook import (
    AgentIntentSignals,
    intent_hook_agent_kinds,
    parse_agent_intent_response,
    render_turn_agent_intent_prompt,
)

logger = logging.getLogger(__name__)

# Backward-compatible alias
TurnIntentSignals = AgentIntentSignals

DEFAULT_INTENT_TEMPLATE_REF = "materials/prompts/planning/turn_agent_intent.md"
DEFAULT_WEB_THRESHOLD = 0.65


def resolve_intent_llm_payload(req: object) -> dict[str, Any] | None:
    """``planning.intent`` → ``planning`` → chat ``endpoint`` fallback for the intent hook."""
    for key in ("planner_intent", "planner"):
        payload = getattr(req, key, None)
        if isinstance(payload, dict):
            base = str(payload.get("base_url") or "").strip()
            model = str(payload.get("model") or "").strip()
            if base and model:
                return payload

    endpoint = getattr(req, "endpoint", None)
    if endpoint is None:
        return None
    base = str(getattr(endpoint, "base_url", "") or "").strip()
    model = str(getattr(endpoint, "model", "") or "").strip()
    if not base or not model:
        return None
    out: dict[str, Any] = {"base_url": base, "model": model}
    api_key_env = getattr(endpoint, "api_key_env", None)
    if isinstance(api_key_env, str) and api_key_env.strip():
        out["api_key_ref"] = api_key_env.strip()
    return out


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


def _web_threshold() -> float:
    from oaao_orchestrator.agent_intent_hook import _web_threshold as _wt

    return _wt()


def _slide_threshold() -> float:
    from oaao_orchestrator.agent_intent_hook import _slide_threshold as _st

    return _st()


def parse_turn_intent_response(text: str) -> TurnIntentSignals | None:
    """Parse intent JSON (defaults to standard hook agent kinds when omitted)."""
    return parse_agent_intent_response(text)


def render_turn_intent_prompt(
    *,
    user_input: str,
    template_ref: str = "",
    extra_vars: dict[str, str] | None = None,
    agent_kinds: list[str] | None = None,
    req: object | None = None,
    intent_payload: dict[str, Any] | None = None,
) -> str:
    kinds = agent_kinds or intent_hook_agent_kinds(req)
    return render_turn_agent_intent_prompt(
        user_input=user_input,
        agent_kinds=kinds,
        extra_vars=extra_vars,
        template_ref=template_ref,
        intent_payload=intent_payload,
        req=req,
    )


async def score_turn_intent(
    req: object,
    *,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
    allowed_agents: list[str] | None = None,
) -> TurnIntentSignals | None:
    """Score agent intent from registry-driven command template."""
    intent_payload = resolve_intent_llm_payload(req)
    if intent_payload is None:
        return None

    user_msg = _last_user_message(getattr(req, "messages", []) or [])
    if not user_msg:
        return None

    from oaao_orchestrator.turn_knowledge_gap import knowledge_gap_context

    gap_ctx = knowledge_gap_context(req, user_message=user_msg)
    agent_kinds = intent_hook_agent_kinds(req, allowed_agents=allowed_agents)

    rendered = render_turn_intent_prompt(
        user_input=user_msg,
        extra_vars=gap_ctx,
        agent_kinds=agent_kinds,
        req=req,
        intent_payload=intent_payload,
    )
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
    signals = parse_agent_intent_response(text, agent_kinds=agent_kinds)
    if signals is None:
        logger.warning("turn_intent_json_parse_failed")
    return signals


async def apply_turn_intent_hook(
    req: object,
    *,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
    allowed_agents: list[str] | None = None,
) -> None:
    """Run planning.intent hook — LLM scores plus temporal knowledge-gap floor."""
    force_globe_web = bool(getattr(req, "enable_web_search", False))

    user_msg = _last_user_message(getattr(req, "messages", []) or [])
    from oaao_orchestrator.turn_knowledge_gap import (
        knowledge_gap_context,
        resolve_llm_knowledge_cutoff,
        temporal_knowledge_gap,
    )

    gap = temporal_knowledge_gap(user_msg, resolve_llm_knowledge_cutoff(req)) if user_msg else False
    intent_payload = resolve_intent_llm_payload(req)

    llm_signals: TurnIntentSignals | None = None
    if intent_payload is not None:
        mdl = str(intent_payload.get("model") or model or "").strip()
        if mdl:
            try:
                llm_signals = await score_turn_intent(
                    req,
                    chat_completions_url=chat_completions_url,
                    api_key=api_key,
                    model=mdl,
                    allowed_agents=allowed_agents,
                )
            except Exception:
                logger.exception("turn_intent_hook_failed")

    if llm_signals is None:
        if not gap and not force_globe_web:
            return
        analysis: dict[str, float] = {"web_search": 1.0} if (gap or force_globe_web) else {}
        from oaao_orchestrator.slide_project.conversation_intent import text_implies_slide_deck_request

        if user_msg and text_implies_slide_deck_request(user_msg):
            analysis["slide_designer"] = 1.0
        llm_signals = AgentIntentSignals(
            needs_web_search=True,
            analysis=analysis,
            reasoning={"web_search": "temporal_knowledge_gap"} if gap else {},
        )

    analysis = dict(llm_signals.analysis)
    web_score = float(analysis.get("web_search", 0.0))
    if gap or force_globe_web:
        web_score = max(web_score, 1.0)
        analysis["web_search"] = web_score
    slide_score = float(analysis.get("slide_designer", 0.0))
    from oaao_orchestrator.slide_project.conversation_intent import text_implies_slide_deck_request

    if user_msg and text_implies_slide_deck_request(user_msg):
        slide_score = max(slide_score, 1.0)
        analysis["slide_designer"] = slide_score
    needs_web = web_score >= _web_threshold()
    needs_slide = slide_score >= _slide_threshold()
    if not needs_web and not needs_slide and not analysis:
        return

    payload: dict[str, Any] = {
        "needs_web_search": needs_web,
        "needs_slide_designer": needs_slide,
        "analysis": analysis,
        "temporal_knowledge_gap": gap,
    }
    if llm_signals.reasoning:
        payload["reasoning"] = dict(llm_signals.reasoning)
    if user_msg:
        payload["llm_knowledge_cutoff"] = knowledge_gap_context(req, user_message=user_msg)[
            "llm_knowledge_cutoff"
        ]

    _attach_turn_intent(req, payload)
    logger.info(
        "turn_intent_scored web_search=%.2f slide_designer=%.2f needs_web=%s needs_slide=%s temporal_gap=%s globe=%s",
        web_score,
        slide_score,
        needs_web,
        needs_slide,
        gap,
        force_globe_web,
    )
