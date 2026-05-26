"""
ACCS — Accuracy & Alignment Consensus Score (Evolution §5).

Heuristic scorer for Phase 8a; E4B coach can replace ``_heuristic_factors``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from oaao_orchestrator.safety.circuit_breaker import BreakerOpen, get_breaker

ALPHA = 0.50
BETA = 0.40
GAMMA = 0.15

THRESHOLD_CRYSTALLIZE = 0.85
THRESHOLD_SHIP = 0.65
THRESHOLD_REFLECT = 0.40


@dataclass
class ACCSResult:
    score: float
    factors: dict[str, float]
    action: str
    skipped: bool = False
    crystallization_candidate: bool = False
    degraded: bool = False
    source: str = "heuristic"


def _clip_score(raw: float) -> float:
    return max(0.0, min(1.0, raw))


def _heuristic_factors(
    user_message: str,
    llm_output: str,
    evidence: list[Any],
) -> tuple[float, dict[str, float]]:
    out = (llm_output or "").lower()
    um = (user_message or "").lower()
    has_evidence = bool(evidence)

    alignment = 0.62
    um_tokens = [w for w in um.split() if len(w) > 2][:4]
    if um_tokens and any(w in out for w in um_tokens):
        alignment = 0.72

    accuracy = 0.74
    if "wrong" in out or "incorrect" in out:
        alignment = 0.68
        accuracy = 0.44
    if "excellent" in out and "citation" in out:
        alignment = 0.95
        accuracy = 0.96

    hallucination = 0.42 if not has_evidence else 0.05
    if has_evidence and ("citation" in out or "source" in out):
        hallucination = 0.03

    raw = ALPHA * alignment + BETA * accuracy - GAMMA * hallucination
    factors = {
        "alignment": alignment,
        "accuracy": accuracy,
        "hallucination_penalty": hallucination,
    }
    return _clip_score(raw), factors


def _action_for_score(score: float) -> tuple[str, bool, bool]:
    crystallization = score >= THRESHOLD_CRYSTALLIZE
    if score >= THRESHOLD_SHIP:
        return "ship", crystallization, False
    if score >= THRESHOLD_REFLECT:
        return "reflect", False, False
    return "ship", False, True


def _accs_from_factors(factors: dict[str, float]) -> float:
    raw = (
        ALPHA * factors["alignment"]
        + BETA * factors["accuracy"]
        - GAMMA * factors["hallucination_penalty"]
    )
    return _clip_score(raw)


async def _score_accs_heuristic(
    *,
    user_message: str,
    llm_output: str,
    evidence: list[Any],
) -> ACCSResult:
    score, factors = _heuristic_factors(user_message, llm_output, evidence)
    action, crystallization, degraded = _action_for_score(score)
    return ACCSResult(
        score=score,
        factors=factors,
        action=action,
        skipped=False,
        crystallization_candidate=crystallization,
        degraded=degraded,
        source="heuristic",
    )


async def _score_accs_coach(
    *,
    user_message: str,
    llm_output: str,
    evidence: list[Any],
    coach_endpoint: dict[str, Any],
) -> ACCSResult:
    from oaao_orchestrator.evaluation.coach_client import (
        CoachCallError,
        build_accs_coach_prompt,
        call_coach_json,
        parse_accs_coach_response,
    )

    prompt = build_accs_coach_prompt(
        user_message=user_message,
        llm_output=llm_output,
        evidence=evidence,
    )
    try:
        raw = await call_coach_json(endpoint=coach_endpoint, prompt=prompt, inline=False)
        factors = parse_accs_coach_response(raw)
    except CoachCallError:
        raise
    except Exception as exc:
        raise CoachCallError(str(exc)[:200]) from exc

    score = _accs_from_factors(factors)
    action, crystallization, degraded = _action_for_score(score)
    return ACCSResult(
        score=score,
        factors=factors,
        action=action,
        skipped=False,
        crystallization_candidate=crystallization,
        degraded=degraded,
        source="coach",
    )


async def score_accs(
    *,
    user_message: str,
    llm_output: str,
    evidence: list[Any] | None = None,
    coach_endpoint: dict[str, Any] | None = None,
) -> ACCSResult:
    """Score assistant output; on breaker open → skip and ship."""
    from oaao_orchestrator.evaluation.coach_client import (
        CoachCallError,
        coach_call_timeout_s,
        coach_endpoint_ready,
    )
    from oaao_orchestrator.safety.circuit_breaker import BreakerTimeout

    ev = list(evidence or [])
    coach_timeout = coach_call_timeout_s(inline=False)
    breaker = get_breaker(
        "accs",
        failure_threshold=3,
        reset_timeout=600.0,
        call_timeout=coach_timeout + 10.0,
    )

    if breaker.state == "open":
        return ACCSResult(
            score=0.0,
            factors={"alignment": 0.0, "accuracy": 0.0, "hallucination_penalty": 0.0},
            action="ship",
            skipped=True,
            source="skipped",
        )

    if coach_endpoint_ready(coach_endpoint):
        assert coach_endpoint is not None
        try:
            return await breaker.call(
                lambda: _score_accs_coach(
                    user_message=user_message,
                    llm_output=llm_output,
                    evidence=ev,
                    coach_endpoint=coach_endpoint,
                )
            )
        except BreakerOpen:
            return ACCSResult(
                score=0.0,
                factors={"alignment": 0.0, "accuracy": 0.0, "hallucination_penalty": 0.0},
                action="ship",
                skipped=True,
                source="skipped",
            )
        except BreakerTimeout:
            fallback = await _score_accs_heuristic(
                user_message=user_message,
                llm_output=llm_output,
                evidence=ev,
            )
            fallback.source = "heuristic_timeout_fallback"
            return fallback
        except CoachCallError:
            if breaker.state == "open":
                return ACCSResult(
                    score=0.0,
                    factors={"alignment": 0.0, "accuracy": 0.0, "hallucination_penalty": 0.0},
                    action="ship",
                    skipped=True,
                    source="skipped",
                )
            fallback = await _score_accs_heuristic(
                user_message=user_message,
                llm_output=llm_output,
                evidence=ev,
            )
            fallback.source = "heuristic_fallback"
            return fallback

    return await _score_accs_heuristic(
        user_message=user_message, llm_output=llm_output, evidence=ev
    )
