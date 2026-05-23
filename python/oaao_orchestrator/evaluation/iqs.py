"""
IQS — Information Quality Score (Evolution §4).

Heuristic scorer for Phase 8a; E4B coach integration can replace ``_score_dimensions``.
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

_ACTION_MARKERS = (
    "做",
    "写",
    "寫",
    "轉",
    "转",
    "生成",
    "分析",
    "帮",
    "幫",
    "請",
    "请",
    "把",
    "convert",
    "create",
    "make",
    "explain",
)
_SPECIFIC_MARKERS = (
    "pdf",
    "页",
    "頁",
    "表格",
    "markdown",
    "第",
    "附件",
    "保留",
    "栏",
    "欄",
    "欄位",
)


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


def _heuristic_dimensions(user_message: str, conversation_history: list[Any]) -> dict[str, float]:
    text = (user_message or "").strip()
    lower = text.lower()
    n = len(text)

    if text in _VAGUE_ONLY or n <= 2:
        return {
            "clarity": 0.40,
            "specificity": 0.35,
            "actionability": 0.35,
            "context_completeness": 0.30,
        }

    has_action = any(m in lower or m in text for m in _ACTION_MARKERS)
    has_specific = any(m in lower or m in text for m in _SPECIFIC_MARKERS)

    if has_specific and has_action and n >= 18:
        return {
            "clarity": 0.92,
            "specificity": 0.95,
            "actionability": 0.93,
            "context_completeness": 0.88,
        }

    clarity = 0.58 if has_action else 0.35
    specificity = min(1.0, n / 28.0)
    if has_specific:
        specificity = max(specificity, 0.82)
    actionability = min(1.0, 0.32 + n / 42.0)
    context_completeness = 0.78 if n > 10 else 0.42
    if conversation_history and n < 12:
        context_completeness = max(0.35, context_completeness - 0.15)

    return {
        "clarity": clarity,
        "specificity": specificity,
        "actionability": actionability,
        "context_completeness": context_completeness,
    }


def _action_for_score(score: float) -> str:
    if score >= THRESHOLD_PASS:
        return "pass"
    if score >= THRESHOLD_CLARIFY:
        return "assume_defaults"
    if score >= THRESHOLD_HARD_CLARIFY:
        return "clarify"
    return "hard_clarify"


def _clarification_questions(user_message: str, dimensions: dict[str, float], action: str) -> list[str]:
    if action not in ("clarify", "hard_clarify"):
        return []

    if (user_message or "").strip() in _VAGUE_ONLY:
        if action == "hard_clarify":
            return [
                "收到。請問你想讓我幫你做哪一件事？",
                "請用一句話描述目標，以及期望的輸出形式。",
            ]
        return ["收到。請問你想讓我幫你做哪一件事？請簡單描述目標或期望結果。"]

    weakest = min(dimensions, key=dimensions.get)
    questions: list[str] = []

    if weakest == "clarity" or dimensions.get("clarity", 1.0) < 0.45:
        questions.append("你想完成什麼具體任務？請用一句話描述目標。")
    if weakest == "specificity" or dimensions.get("specificity", 1.0) < 0.45:
        questions.append("有哪些檔案、格式或欄位需要處理？")
    if weakest == "actionability" or dimensions.get("actionability", 1.0) < 0.45:
        questions.append("期望的輸出形式是什麼（例如 Markdown、表格、摘要）？")
    if weakest == "context_completeness" or dimensions.get("context_completeness", 1.0) < 0.45:
        questions.append("「這個／那個」指的是哪一項內容？請補充上下文。")

    if not questions:
        questions.append("能否再具體說明你的需求與期望結果？")

    if action == "hard_clarify":
        while len(questions) < 3:
            questions.append("請提供一個完整範例輸入，方便我們對齊格式與內容。")
        questions = questions[:4]
    else:
        questions = questions[:2]

    return questions


async def _score_iqs_heuristic(
    *,
    user_message: str,
    conversation_history: list[Any],
) -> IQSResult:
    dims = _heuristic_dimensions(user_message, conversation_history)
    score = combine_dimensions(
        clarity=dims["clarity"],
        specificity=dims["specificity"],
        actionability=dims["actionability"],
        context_completeness=dims["context_completeness"],
    )
    action = _action_for_score(score)
    questions = _clarification_questions(user_message, dims, action)
    return IQSResult(
        score=score,
        dimensions=dims,
        action=action,
        clarification_questions=questions,
        skipped=False,
        source="heuristic",
    )


async def _score_iqs_coach(
    *,
    user_message: str,
    conversation_history: list[Any],
    coach_endpoint: dict[str, Any],
) -> IQSResult:
    from oaao_orchestrator.evaluation.coach_client import (  # noqa: PLC0415
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
        raw = await call_coach_json(endpoint=coach_endpoint, prompt=prompt)
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
    questions = coach_questions or _clarification_questions(user_message, dims, action)
    return IQSResult(
        score=score,
        dimensions=dims,
        action=action,
        clarification_questions=questions,
        skipped=False,
        source="coach",
    )


async def score_iqs(
    *,
    user_message: str,
    conversation_history: list[Any] | None = None,
    coach_endpoint: dict[str, Any] | None = None,
) -> IQSResult:
    """Score user input quality; on breaker open → skip and pass through."""
    from oaao_orchestrator.evaluation.coach_client import CoachCallError, coach_endpoint_ready  # noqa: PLC0415

    history = list(conversation_history or [])
    breaker = get_breaker("iqs", failure_threshold=3, reset_timeout=600.0, call_timeout=8.0)

    if breaker.state == "open":
        return IQSResult(
            score=0.0,
            dimensions={d: 0.0 for d in DIMENSION_WEIGHTS},
            action="pass",
            clarification_questions=[],
            skipped=True,
            source="skipped",
        )

    if coach_endpoint_ready(coach_endpoint):
        assert coach_endpoint is not None
        try:
            return await breaker.call(
                lambda: _score_iqs_coach(
                    user_message=user_message,
                    conversation_history=history,
                    coach_endpoint=coach_endpoint,
                )
            )
        except BreakerOpen:
            return IQSResult(
                score=0.0,
                dimensions={d: 0.0 for d in DIMENSION_WEIGHTS},
                action="pass",
                clarification_questions=[],
                skipped=True,
                source="skipped",
            )
        except CoachCallError:
            if breaker.state == "open":
                return IQSResult(
                    score=0.0,
                    dimensions={d: 0.0 for d in DIMENSION_WEIGHTS},
                    action="pass",
                    clarification_questions=[],
                    skipped=True,
                    source="skipped",
                )
            fallback = await _score_iqs_heuristic(
                user_message=user_message,
                conversation_history=history,
            )
            fallback.source = "heuristic_fallback"
            return fallback

    return await _score_iqs_heuristic(user_message=user_message, conversation_history=history)
