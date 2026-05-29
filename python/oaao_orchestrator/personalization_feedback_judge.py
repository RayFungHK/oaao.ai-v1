"""UX-1-S11 — downvote feedback judge (v1 heuristic; optional LLM later)."""

from __future__ import annotations

from typing import Any


def run_feedback_judge(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Produce structured tuning hints after thumbs-down — not auto-applied by default.

    PHP persists into ``preferences_json.feedback_judge_audit``.
    """
    locale = str(payload.get("locale") or "en").lower()
    zh = locale.startswith("zh")

    suggestions: list[dict[str, str]] = [
        {
            "param": "temperature",
            "direction": "decrease",
            "reason": (
                "回覆可能過長或偏離預期，可略降 temperature。"
                if zh
                else "Reply may be too verbose or off-tone; try a lower temperature."
            ),
        },
        {
            "param": "presence_penalty",
            "direction": "increase",
            "reason": (
                "略提高 presence_penalty 可減少重複用詞。"
                if zh
                else "Slightly higher presence_penalty can reduce repetition."
            ),
        },
    ]

    summary = (
        "建議：略降 temperature、略升 penalty；可在設定 → Advanced 手動確認。"
        if zh
        else "Suggestion: slightly lower temperature and higher penalties; confirm under Settings → Advanced."
    )

    return {
        "suggestions": suggestions,
        "summary": summary,
        "auto_apply": False,
        "source": "heuristic_v1",
    }
