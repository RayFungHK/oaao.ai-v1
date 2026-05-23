"""
Reflection loop — bounded self-critique with Main Reasoner re-gen (Evolution §6).

At most one round; no vault_rag re-run during reflection.
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import Any

from oaao_orchestrator.evaluation.accs import ACCSResult, score_accs

MAX_REFLECTION_ROUNDS = 1

RegenerateFn = Callable[[str, ACCSResult], Awaitable[str | None]]


def _reflection_disabled() -> bool:
    return os.environ.get("OAAO_REFLECTION_DISABLE", "").strip().lower() in ("1", "true", "yes")


def build_reflection_critique(accs: ACCSResult) -> str:
    """Coach-style critique from ACCS factor breakdown."""
    lines = [
        "Your previous answer needs improvement before shipping.",
        "Address these quality issues specifically:",
    ]
    for name, val in accs.factors.items():
        lines.append(f"- {name}: {val:.2f}")
    lines.append(
        "Rewrite the answer for the user. Use the conversation context and prior evidence only — "
        "do not claim new vault searches or external lookups."
    )
    return "\n".join(lines)


async def run_reflection_loop(
    *,
    user_message: str,
    first_output: str,
    evidence: list[Any] | None = None,
    max_rounds: int = 1,
    coach_endpoint: dict[str, Any] | None = None,
    initial_accs: ACCSResult | None = None,
    regenerate: RegenerateFn | None = None,
) -> list[dict[str, Any]]:
    """
    Run at most one reflection round regardless of ``max_rounds`` (§6.2).

    When ``regenerate`` is provided, calls Main Reasoner for a revised answer.
    """
    if _reflection_disabled():
        return []

    allowed = min(max(0, int(max_rounds)), MAX_REFLECTION_ROUNDS)
    if allowed < 1:
        return []

    ev = list(evidence or [])
    initial = initial_accs
    if initial is None:
        initial = await score_accs(
            user_message=user_message,
            llm_output=first_output,
            evidence=ev,
            coach_endpoint=coach_endpoint,
        )
    if initial.skipped or initial.action != "reflect":
        return []

    critique = build_reflection_critique(initial)
    revised: str | None = None
    if regenerate is not None:
        revised = await regenerate(critique, initial)
    if not (revised or "").strip():
        revised = f"{first_output.rstrip()}\n\n[Reflection pass: {critique}]"

    rescored = await score_accs(
        user_message=user_message,
        llm_output=revised,
        evidence=ev,
        coach_endpoint=coach_endpoint,
    )

    return [
        {
            "round": 1,
            "output": revised,
            "initial_score": initial.score,
            "final_score": rescored.score,
            "degraded": rescored.score < 0.40,
            "critique": critique,
            "reflection_rescored": {
                "score": rescored.score,
                "action": rescored.action,
                "factors": rescored.factors,
                "degraded": rescored.degraded,
            },
        }
    ]
