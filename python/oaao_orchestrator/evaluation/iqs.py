"""
IQS — Information Quality Score (Evolution §4).

Primary scorer: E4B coach (``uiqe`` purpose) with conversation history in ``iqs_coach.md``.
Inline preflight records scores for telemetry; by default it does **not** block chat (see
``OAAO_IQS_INLINE_CLARIFY``). Multi-turn threads never inline-clarify — context lives in history.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from oaao_orchestrator.safety.circuit_breaker import BreakerOpen, get_breaker

DIMENSION_WEIGHTS: dict[str, float] = {
    "clarity": 0.30,
    "specificity": 0.25,
    "actionability": 0.25,
    "context_completeness": 0.20,
}
EPSILON = 0.05

THRESHOLD_PASS = 0.80
THRESHOLD_CLARIFY = 0.50
THRESHOLD_HARD_CLARIFY = 0.30

_VAGUE_ONLY = frozenset({"嗯", "好", "ok", "hi", "?", "...", "嗯嗯"})

_HEURISTIC_PASS_DIMS: dict[str, float] = {
    "clarity": 0.85,
    "specificity": 0.85,
    "actionability": 0.85,
    "context_completeness": 0.85,
}

_HEURISTIC_VAGUE_DIMS: dict[str, float] = {
    "clarity": 0.40,
    "specificity": 0.35,
    "actionability": 0.35,
    "context_completeness": 0.30,
}


@dataclass
class IQSResult:
    score: float
    dimensions: dict[str, float]
    action: str
    clarification_questions: list[str] = field(default_factory=list)
    skipped: bool = False
    source: str = "heuristic"


def combine_dimensions(
    *,
    clarity: float,
    specificity: float,
    actionability: float,
    context_completeness: float,
) -> float:
    """Weighted geometric mean with ε floor per §4.2."""
    dims = {
        "clarity": clarity,
        "specificity": specificity,
        "actionability": actionability,
        "context_completeness": context_completeness,
    }
    weight_sum = sum(DIMENSION_WEIGHTS.values())
    product = 1.0
    for name, weight in DIMENSION_WEIGHTS.items():
        product *= max(float(dims[name]), EPSILON) ** weight
    return float(product ** (1.0 / weight_sum))


def _normalize_history(conversation_history: list[Any]) -> list[dict[str, Any]]:
    msgs: list[dict[str, Any]] = [m for m in conversation_history if isinstance(m, dict)]
    while msgs:
        role = str(msgs[-1].get("role") or "").strip().lower()
        content = str(msgs[-1].get("content") or "").strip()
        if role == "assistant" and not content:
            msgs.pop()
        else:
            break
    return msgs


def _has_prior_turn_context(conversation_history: list[Any]) -> bool:
    """True when any completed turn exists before the latest user message."""
    msgs = _normalize_history(list(conversation_history or []))
    if len(msgs) <= 1:
        return False
    for msg in msgs[:-1]:  # noqa: SIM110
        if str(msg.get("content") or "").strip():
            return True
    return False


def should_bypass_iqs_clarify(user_message: str, conversation_history: list[Any] | None) -> bool:
    """
    Multi-turn threads carry context in history — never inline-clarify.

    Structural rule only; does not depend on keyword lists or coach dimension scores.
    """
    text = (user_message or "").strip()
    if not text or text in _VAGUE_ONLY:
        return False
    return _has_prior_turn_context(list(conversation_history or []))


def _action_for_score(score: float) -> str:
    if score >= THRESHOLD_PASS:
        return "pass"
    if score >= THRESHOLD_CLARIFY:
        return "assume_defaults"
    if score >= THRESHOLD_HARD_CLARIFY:
        return "clarify"
    return "hard_clarify"


def _iqs_skipped_on_breaker(
    *,
    user_message: str,
    conversation_history: list[Any],
    inline: bool,
) -> IQSResult:
    """When inline coach breaker is open — skip scoring, never block the user."""
    return _finalize_iqs_result(
        IQSResult(
            score=0.0,
            dimensions={name: 0.0 for name in DIMENSION_WEIGHTS},
            action="pass",
            skipped=True,
            source="skipped",
        ),
        user_message=user_message,
        conversation_history=conversation_history,
        inline=inline,
    )


def _finalize_iqs_result(
    result: IQSResult,
    *,
    user_message: str,
    conversation_history: list[Any],
    inline: bool = False,
) -> IQSResult:
    from oaao_orchestrator.evaluation.coach_client import (
        inline_iqs_clarify_enabled,
    )

    history = list(conversation_history or [])
    if should_bypass_iqs_clarify(user_message, history):
        result.clarification_questions = []
        if result.action in ("clarify", "hard_clarify"):
            result.action = "assume_defaults"
    if result.action in ("clarify", "hard_clarify") and not result.clarification_questions:
        result.action = "assume_defaults"
    if inline and not inline_iqs_clarify_enabled():
        result.clarification_questions = []
    return result


def _heuristic_dimensions(user_message: str, conversation_history: list[Any]) -> dict[str, float]:
    """Minimal safe fallback when E4B coach is down — no keyword scoring."""
    text = (user_message or "").strip()
    if text in _VAGUE_ONLY or len(text) <= 2:
        return dict(_HEURISTIC_VAGUE_DIMS)
    return dict(_HEURISTIC_PASS_DIMS)


async def _score_iqs_heuristic(
    *,
    user_message: str,
    conversation_history: list[Any],
    inline: bool = False,
) -> IQSResult:
    dims = _heuristic_dimensions(user_message, conversation_history)
    score = combine_dimensions(
        clarity=dims["clarity"],
        specificity=dims["specificity"],
        actionability=dims["actionability"],
        context_completeness=dims["context_completeness"],
    )
    action = _action_for_score(score)
    return _finalize_iqs_result(
        IQSResult(
            score=score,
            dimensions=dims,
            action=action,
            clarification_questions=[],
            skipped=False,
            source="heuristic",
        ),
        user_message=user_message,
        conversation_history=conversation_history,
        inline=inline,
    )


async def _score_iqs_coach(
    *,
    user_message: str,
    conversation_history: list[Any],
    coach_endpoint: dict[str, Any],
    inline: bool = False,
) -> IQSResult:
    from oaao_orchestrator.evaluation.coach_client import (
        CoachCallError,
        build_iqs_coach_prompt,
        call_coach_json,
        parse_iqs_coach_response,
    )

    prompt = build_iqs_coach_prompt(
        user_message=user_message,
        conversation_history=conversation_history,
    )
    try:
        raw = await call_coach_json(
            endpoint=coach_endpoint,
            prompt=prompt,
            inline=inline,
        )
        dims, coach_questions = parse_iqs_coach_response(raw)
    except CoachCallError:
        raise
    except Exception as exc:
        raise CoachCallError(str(exc)[:200]) from exc

    score = combine_dimensions(
        clarity=dims["clarity"],
        specificity=dims["specificity"],
        actionability=dims["actionability"],
        context_completeness=dims["context_completeness"],
    )
    action = _action_for_score(score)
    questions = list(coach_questions) if coach_questions else []
    return _finalize_iqs_result(
        IQSResult(
            score=score,
            dimensions=dims,
            action=action,
            clarification_questions=questions,
            skipped=False,
            source="coach",
        ),
        user_message=user_message,
        conversation_history=conversation_history,
        inline=inline,
    )


async def score_iqs(
    *,
    user_message: str,
    conversation_history: list[Any] | None = None,
    coach_endpoint: dict[str, Any] | None = None,
    inline: bool = False,
) -> IQSResult:
    """Score user input quality; on breaker open / timeout → degrade, do not block users."""
    from oaao_orchestrator.evaluation.coach_client import (
        CoachCallError,
        coach_call_timeout_s,
        coach_endpoint_ready,
        inline_iqs_coach_disabled,
    )
    from oaao_orchestrator.safety.circuit_breaker import BreakerTimeout

    history = list(conversation_history or [])
    use_coach = coach_endpoint_ready(coach_endpoint)
    if inline and inline_iqs_coach_disabled():
        use_coach = False

    coach_timeout = coach_call_timeout_s(inline=inline)

    async def _coach_call() -> IQSResult:
        assert coach_endpoint is not None
        return await _score_iqs_coach(
            user_message=user_message,
            conversation_history=history,
            coach_endpoint=coach_endpoint,
            inline=inline,
        )

    if use_coach and not inline:
        try:
            return await _coach_call()
        except CoachCallError:
            fallback = await _score_iqs_heuristic(
                user_message=user_message,
                conversation_history=history,
                inline=inline,
            )
            fallback.source = "heuristic_fallback"
            return fallback

    if use_coach and inline:
        breaker = get_breaker(
            "iqs",
            failure_threshold=3,
            reset_timeout=600.0,
            call_timeout=coach_timeout + 2.0,
        )
        if breaker.state == "open":
            return _iqs_skipped_on_breaker(
                user_message=user_message,
                conversation_history=history,
                inline=inline,
            )
        try:
            return await breaker.call(_coach_call)
        except BreakerOpen:
            return _iqs_skipped_on_breaker(
                user_message=user_message,
                conversation_history=history,
                inline=inline,
            )
        except BreakerTimeout:
            fallback = await _score_iqs_heuristic(
                user_message=user_message,
                conversation_history=history,
                inline=inline,
            )
            fallback.source = "heuristic_timeout_fallback"
            return fallback
        except CoachCallError:
            if breaker.state == "open":
                return _iqs_skipped_on_breaker(
                    user_message=user_message,
                    conversation_history=history,
                    inline=inline,
                )
            fallback = await _score_iqs_heuristic(
                user_message=user_message,
                conversation_history=history,
                inline=inline,
            )
            fallback.source = "heuristic_fallback"
            return fallback

    return await _score_iqs_heuristic(
        user_message=user_message,
        conversation_history=history,
        inline=inline,
    )
