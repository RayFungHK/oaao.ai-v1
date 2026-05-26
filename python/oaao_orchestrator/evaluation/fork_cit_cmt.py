"""CIT/CMT compacted context for conversation fork handoff."""

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

# UI shows the handoff label — do not duplicate this line inside stored markdown.
_HANDOFF_HEADER_ZH = "上文承接（CIT/CMT） — 由前一個對話壓縮帶入"
_HANDOFF_HEADER_EN = "Context carry-over (CIT/CMT) — compacted from the previous chat"

_CIT_CMT_COACH_PROMPT = """You compress a chat thread for a **new** conversation fork (CIT/CMT).

Produce a single markdown block the new assistant can read as prior context.

Rules:
- Preserve: user goals, constraints, file/vault names, decisions, open questions, what was tried, factual conclusions.
- For vault/RAG turns: what was found vs not found in sources.
- Drop: greetings, repeated apologies, filler.
- Match the user's language (Chinese if the thread is mostly Chinese).
- Do NOT invent facts not in the transcript.
- Do NOT include the seed_prompt verbatim in compacted_markdown — the UI composer carries the user's next message.

Return JSON only:
{"compacted_markdown": "...", "tail_count": <int>}

Transcript:
{transcript}

Seed for the new chat (may be empty):
{seed_prompt}
"""


def _looks_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def _trim_snippet(text: str, *, limit: int = 480) -> str:
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if len(raw) <= limit:
        return raw
    return raw[: limit - 1].rstrip() + "…"


def _snippet_preserve_structure(text: str, *, limit: int = 1200) -> str:
    """Keep paragraph breaks for verbatim handoff tails — do not collapse markdown."""
    raw = (text or "").replace("\r\n", "\n").strip()
    if len(raw) <= limit:
        return raw
    cut = raw[:limit]
    if "\n\n" in cut:
        cut = cut.rsplit("\n\n", 1)[0]
    return cut.rstrip() + "\n\n…"


def normalize_handoff_markdown(text: str) -> str:
    """Ensure ATX headers start on their own lines — skip ordered-list lines like ``# 1.``."""
    raw = (text or "").replace("\r\n", "\n").strip()
    if not raw:
        return ""
    raw = re.sub(
        r"([^\n])(#{1,6})(\s+)(?![0-9]+\.)",
        r"\1\n\n\2\3",
        raw,
    )
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def strip_handoff_header_line(text: str) -> str:
    """Remove duplicate CIT/CMT title — the chat UI renders its own label."""
    raw = (text or "").replace("\r\n", "\n").strip()
    if not raw:
        return ""
    lines = raw.split("\n")
    if not lines:
        return raw
    first = re.sub(r"[*_`]", "", lines[0]).strip()
    if "CIT/CMT" in first or "上文承接" in first or "carry-over" in first.lower():
        rest = "\n".join(lines[1:]).strip()
        return rest
    return raw


def _format_transcript(messages: list[dict[str, Any]], *, snippet_limit: int = 1200) -> str:
    lines: list[str] = []
    for i, row in enumerate(messages):
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "?").strip().lower()
        if role not in ("user", "assistant"):
            continue
        body = _trim_snippet(str(row.get("content") or ""), limit=snippet_limit)
        if not body:
            continue
        lines.append(f"[{i}] {role}:\n{body}")
    return "\n\n---\n\n".join(lines)


def heuristic_fork_handoff(
    *,
    recent_messages: list[dict[str, Any]],
    seed_prompt: str = "",
    locale_hint: str = "",
) -> dict[str, Any]:
    """CMT-style tail keep + CIT-style bullet summary for older turns."""
    usable = [
        m
        for m in recent_messages
        if isinstance(m, dict) and str(m.get("role") or "").lower() in ("user", "assistant")
    ]
    n = len(usable)
    tail_count = min(4, n) if n > 0 else 0
    older = usable[: max(0, n - tail_count)] if tail_count else []
    tail = usable[max(0, n - tail_count) :] if tail_count else []

    zh = _looks_chinese(locale_hint) or any(_looks_chinese(str(m.get("content") or "")) for m in usable[-3:])

    section_older = "### 較早對話（摘要）" if zh else "### Earlier turns (summary)"
    section_recent = "### 最近對話（原文摘要）" if zh else "### Recent turns (excerpt)"
    role_user = "用户" if zh else "user"
    role_asst = "助手" if zh else "assistant"

    parts: list[str] = []
    if older:
        parts.append(section_older)
        for row in older[-8:]:
            role = str(row.get("role") or "?").lower()
            label = role_user if role == "user" else role_asst if role == "assistant" else role
            parts.append(f"- **{label}**: {_trim_snippet(str(row.get('content') or ''), limit=280)}")
        parts.append("")

    if tail:
        parts.append(section_recent)
        for row in tail:
            role = str(row.get("role") or "?").lower()
            label = role_user if role == "user" else role_asst if role == "assistant" else role
            body = _snippet_preserve_structure(str(row.get("content") or ""), limit=900)
            parts.append(f"**{label}**:\n\n{body}")
            parts.append("")

    content = strip_handoff_header_line("\n".join(parts).strip())
    return {
        "compacted_content": content,
        "tail_count": tail_count,
        "source": "heuristic",
    }


async def _coach_fork_handoff(
    *,
    recent_messages: list[dict[str, Any]],
    seed_prompt: str,
    coach_endpoint: dict[str, Any],
) -> dict[str, Any] | None:
    transcript = _format_transcript(recent_messages)
    if not transcript.strip():
        return None
    prompt = _CIT_CMT_COACH_PROMPT.format(
        transcript=transcript[:24000],
        seed_prompt=(seed_prompt or "").strip()[:2000],
    )
    try:
        parsed = await call_coach_json(
            endpoint=coach_endpoint,
            prompt=prompt,
            timeout_s=min(coach_call_timeout_s(inline=False), 45.0),
        )
    except CoachCallError as exc:
        logger.info("fork_cit_cmt coach failed: %s", exc.detail)
        return None
    if not isinstance(parsed, dict):
        return None
    md = str(parsed.get("compacted_markdown") or parsed.get("compacted_content") or "").strip()
    if not md:
        return None
    try:
        tail_count = int(parsed.get("tail_count") or 0)
    except (TypeError, ValueError):
        tail_count = 0
    md = strip_handoff_header_line(normalize_handoff_markdown(md))
    return {
        "compacted_content": md,
        "tail_count": max(0, tail_count),
        "source": "coach",
    }


async def build_fork_handoff_compacted(
    *,
    parent_conversation_id: int,
    recent_messages: list[dict[str, Any]] | None = None,
    seed_prompt: str = "",
    coach_endpoint: dict[str, Any] | None = None,
    locale_hint: str = "",
) -> dict[str, Any]:
    msgs = list(recent_messages or [])
    seed = (seed_prompt or "").strip()
    hint = locale_hint or seed
    for row in reversed(msgs):
        if isinstance(row, dict) and str(row.get("role") or "").lower() == "user":
            c = str(row.get("content") or "").strip()
            if c:
                hint = c
                break

    if coach_endpoint_ready(coach_endpoint):
        assert coach_endpoint is not None
        coached = await _coach_fork_handoff(
            recent_messages=msgs,
            seed_prompt=seed,
            coach_endpoint=coach_endpoint,
        )
        if coached and coached.get("compacted_content"):
            coached["parent_conversation_id"] = int(parent_conversation_id)
            return coached

    out = heuristic_fork_handoff(
        recent_messages=msgs,
        seed_prompt=seed,
        locale_hint=hint,
    )
    out["parent_conversation_id"] = int(parent_conversation_id)
    return out
