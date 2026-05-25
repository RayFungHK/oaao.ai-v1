"""Conversation thread title — planner-first, chat-endpoint fallback."""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_PLACEHOLDER_TITLES = frozenset({"", "new chat", "new conversation"})
_GENERIC_USER_MESSAGES = frozenset(
    {
        "please read the attached file(s) and respond helpfully.",
        "create a slide presentation using my selected template.",
        "create a slide presentation using the selected template.",
    }
)


def normalize_conversation_title(raw: str | None) -> str:
    t = re.sub(r"\s+", " ", str(raw or "").strip())
    t = t.strip("\"'""''`")
    if not t:
        return ""
    if len(t) > 80:
        t = t[:80].rstrip()
    return t


def is_placeholder_conversation_title(title: str | None) -> bool:
    return normalize_conversation_title(title).lower() in _PLACEHOLDER_TITLES


def _title_timeout_s() -> float:
    raw = os.environ.get("OAAO_CHAT_TITLE_TIMEOUT_S", "12").strip()
    try:
        return max(2.0, min(30.0, float(raw)))
    except ValueError:
        return 12.0


async def generate_conversation_title_via_chat(
    *,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
    user_message: str,
    assistant_snippet: str = "",
) -> str | None:
    """Single chat-endpoint call — short title in the user's language."""
    from oaao_orchestrator.planner_llm import llm_chat_completion_text  # noqa: PLC0415

    user = (user_message or "").strip()
    if not user:
        return None
    asst = (assistant_snippet or "").strip()
    if len(asst) > 360:
        asst = asst[:360].rstrip() + "…"
    user_block = user if len(user) <= 1200 else user[:1200].rstrip() + "…"
    lines = [
        "Write a short chat thread title (max 8 words).",
        "Use the same language as the user message.",
        "Output ONLY the title — no quotes, markdown, or explanation.",
        "",
        f"User message:\n{user_block}",
    ]
    if asst:
        lines.extend(["", f"Assistant reply (snippet):\n{asst}"])
    prompt = "\n".join(lines)
    text = await llm_chat_completion_text(
        url=chat_completions_url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": "You name chat threads concisely."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        timeout_s=_title_timeout_s(),
        max_tokens=48,
    )
    title = normalize_conversation_title(text)
    if not title or title.lower() in _PLACEHOLDER_TITLES:
        return None
    return title


def fallback_conversation_title(user_message: str, attachments: list[Any] | None = None) -> str | None:
    """Deterministic title when planner / LLM naming is unavailable."""
    msg = normalize_conversation_title(user_message)
    if msg and msg.lower() not in _GENERIC_USER_MESSAGES:
        words = msg.split()[:8]
        if words:
            return normalize_conversation_title(" ".join(words))
    for att in attachments or []:
        if not isinstance(att, dict):
            continue
        fname = str(att.get("file_name") or att.get("name") or "").strip()
        if not fname:
            continue
        stem = Path(fname).stem.strip()
        title = normalize_conversation_title(stem)
        if title and title.lower() not in _PLACEHOLDER_TITLES:
            return title
    return None


async def resolve_conversation_title_for_run(
    req: Any,
    *,
    plan: Any | None,
    user_message: str,
    assistant_snippet: str,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
) -> str | None:
    if not getattr(req, "is_new_conversation", False):
        return None
    attachments = list(getattr(req, "chat_attachments", None) or [])
    planner_title = ""
    if plan is not None:
        planner_title = normalize_conversation_title(getattr(plan, "conversation_title", None))
    if planner_title and planner_title.lower() not in _PLACEHOLDER_TITLES:
        return planner_title
    try:
        llm_title = await generate_conversation_title_via_chat(
            chat_completions_url=chat_completions_url,
            api_key=api_key,
            model=model,
            user_message=user_message,
            assistant_snippet=assistant_snippet,
        )
        if llm_title:
            return llm_title
    except Exception:
        logger.exception("conversation_title chat fallback failed")
    return fallback_conversation_title(user_message, attachments)
