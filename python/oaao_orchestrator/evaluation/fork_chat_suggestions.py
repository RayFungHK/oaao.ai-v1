"""Fork-chat starter prompts when thread health alerts fire (Evolution / Manus gap P1)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from oaao_orchestrator.evaluation.coach_client import (
    CoachCallError,
    call_coach_json,
    coach_call_timeout_s,
    coach_endpoint_ready,
)

logger = logging.getLogger(__name__)

_INTRO_ZH = (
    "對話中話題可能開始偏離，或 AI 對你的輸入理解不夠準確。"
    "可以選以下其中一則開場建立新 Chat，重新聚焦需求："
)
_INTRO_EN = (
    "The thread may be drifting or missing your intent. "
    "Pick one starter below to open a fresh chat and refocus:"
)


def _looks_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def default_intro(*, locale_hint: str = "") -> str:
    if locale_hint.lower().startswith("zh") or _looks_chinese(locale_hint):
        return _INTRO_ZH
    return _INTRO_EN


def _trim_snippet(text: str, *, limit: int = 96) -> str:
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if len(raw) <= limit:
        return raw
    return raw[: limit - 1].rstrip() + "…"


def heuristic_fork_suggestions(
    *,
    alert: str,
    health: dict[str, Any] | None,
    recent_user_messages: list[str],
) -> list[str]:
    """Template starters — same language as the latest user message when possible."""
    last = ""
    for msg in reversed(recent_user_messages):
        if (msg or "").strip():
            last = msg.strip()
            break
    zh = _looks_chinese(last)
    snippet = _trim_snippet(last)

    if zh:
        if alert in ("misunderstanding_loop", "drift"):
            out = [
                "請用一句話總結我真正想解決的核心問題，並列出你還需要我補充的三個關鍵資訊。",
                "前面幾輪可能偏離了 — 請忽略舊上下文，只根據下面這段需求重新回答："
                + (f"「{snippet}」" if snippet else ""),
                "我想重新開一個對話：請先確認你理解我的目標，再給出分步計劃。",
            ]
        else:
            out = [
                "請用更精確的方式重述我的需求，並先問一個澄清問題再開始回答。"
                + (f"（背景：{snippet}）" if snippet else ""),
                "總結目前對話中已達成共識的部分，並指出仍不明確、需要我補充的地方。",
                "假設前面回答品質不夠好 — 請從頭用條列式方式回覆我的原始問題。",
            ]
    else:
        if alert in ("misunderstanding_loop", "drift"):
            out = [
                "In one sentence, state the core problem I am trying to solve, then list three clarifying questions.",
                "Ignore prior context — respond only to this restated goal:"
                + (f" “{snippet}”" if snippet else ""),
                "Start fresh: confirm your understanding of my goal, then propose a step-by-step plan.",
            ]
        else:
            out = [
                "Restate my request more precisely and ask one clarifying question before answering."
                + (f" (Context: {snippet})" if snippet else ""),
                "Summarize what we already agreed on and what is still ambiguous.",
                "Assume earlier replies missed the mark — answer my original question from scratch in bullet points.",
            ]

    cleaned = [s.strip() for s in out if s.strip()]
    return cleaned[:3]


async def _coach_suggestions(
    *,
    alert: str,
    health: dict[str, Any] | None,
    recent_messages: list[dict[str, Any]],
    coach_endpoint: dict[str, Any],
) -> list[str] | None:
    health = health or {}
    transcript_lines: list[str] = []
    for row in recent_messages[-8:]:
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "").strip().lower()
        content = _trim_snippet(str(row.get("content") or ""), limit=320)
        if not content:
            continue
        transcript_lines.append(f"{role}: {content}")

    prompt = (
        "You help users restart a chat when quality alerts fire.\n"
        f"Alert: {alert}\n"
        f"Health: {json.dumps(health, ensure_ascii=False)}\n"
        "Recent transcript:\n"
        + "\n".join(transcript_lines)
        + "\n\n"
        "Return JSON only: {\"suggestions\": [\"...\", \"...\", \"...\"]}\n"
        "Rules:\n"
        "- Exactly 2 or 3 suggestions.\n"
        "- Each suggestion is a single first user message for a NEW chat (one line, <= 200 chars).\n"
        "- Match the user's language (Chinese if transcript is mostly Chinese).\n"
        "- Make them actionable: restate goal, narrow scope, or ask for a clean summary.\n"
        "- Do not mention ACCS, scores, or system alerts."
    )
    try:
        parsed = await call_coach_json(
            endpoint=coach_endpoint,
            prompt=prompt,
            timeout_s=min(coach_call_timeout_s(inline=False), 25.0),
        )
    except CoachCallError as exc:
        logger.info("fork_chat coach failed: %s", exc.detail)
        return None
    if not isinstance(parsed, dict):
        return None
    raw = parsed.get("suggestions")
    if not isinstance(raw, list):
        return None
    out: list[str] = []
    for item in raw:
        s = str(item or "").strip()
        if s and s not in out:
            out.append(s[:400])
        if len(out) >= 3:
            break
    return out or None


async def build_fork_chat_suggestions(
    *,
    alert: str,
    health: dict[str, Any] | None = None,
    recent_messages: list[dict[str, Any]] | None = None,
    recent_user_messages: list[str] | None = None,
    coach_endpoint: dict[str, Any] | None = None,
    locale_hint: str = "",
) -> dict[str, Any]:
    """Intro + 2–3 fork starter prompts for Settings / composer banner."""
    alert = (alert or "none").strip() or "none"
    msgs = list(recent_messages or [])
    user_lines = list(recent_user_messages or [])
    if not user_lines:
        for row in msgs:
            if isinstance(row, dict) and str(row.get("role") or "").lower() == "user":
                c = str(row.get("content") or "").strip()
                if c:
                    user_lines.append(c)

    hint = locale_hint or (user_lines[-1] if user_lines else "")
    intro = default_intro(locale_hint=hint)
    source = "heuristic"

    suggestions: list[str] | None = None
    if coach_endpoint_ready(coach_endpoint) and alert != "none":
        suggestions = await _coach_suggestions(
            alert=alert,
            health=health,
            recent_messages=msgs,
            coach_endpoint=coach_endpoint or {},
        )
        if suggestions:
            source = "coach"

    if not suggestions:
        suggestions = heuristic_fork_suggestions(
            alert=alert,
            health=health,
            recent_user_messages=user_lines,
        )

    return {
        "intro": intro,
        "suggestions": suggestions[:3],
        "source": source,
        "alert": alert,
    }
