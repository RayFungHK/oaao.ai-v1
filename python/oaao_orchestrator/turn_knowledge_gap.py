"""Cutoff + temporal gap for ``planning.intent`` routing.

LLM scores via ``turn_agent_intent.md``; when the user cites calendar periods after
``llm_knowledge_cutoff``, :func:`temporal_knowledge_gap` floors ``web_search`` at 1.0.
"""

from __future__ import annotations

import os
import re
from datetime import UTC, date, datetime
from typing import Any

_DEFAULT_KNOWLEDGE_CUTOFF = "2025-01-01"

_ISO_DATE_RE = re.compile(r"(?<!\d)(20\d{2})-(\d{1,2})-(\d{1,2})(?!\d)")
_CN_YM_RE = re.compile(r"(?<!\d)(20\d{2})\s*年\s*(\d{1,2})?\s*月")
_EN_MY_RE = re.compile(
    r"\b(january|february|march|april|may|june|july|august|september|october|november|december)"
    r"\s+(20\d{2})\b",
    re.IGNORECASE,
)
_BARE_YEAR_RE = re.compile(r"(?<!\d)(20\d{2})(?!\d)")

_MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


def _parse_iso_date(raw: str) -> date | None:
    try:
        return date.fromisoformat(raw.strip()[:10])
    except ValueError:
        return None


def _safe_date(year: int, month: int, day: int = 1) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def resolve_llm_knowledge_cutoff(req: object | None) -> date:
    """Last day the chat model can reliably know from training (endpoint config → env → default)."""
    if req is not None:
        endpoint = getattr(req, "endpoint", None)
        if endpoint is not None:
            direct = getattr(endpoint, "knowledge_cutoff", None)
            if isinstance(direct, str) and direct.strip():
                parsed = _parse_iso_date(direct)
                if parsed is not None:
                    return parsed
            cfg = getattr(endpoint, "config", None)
            if isinstance(cfg, dict):
                for key in ("knowledge_cutoff", "knowledge_until", "training_cutoff"):
                    raw = cfg.get(key)
                    if isinstance(raw, str) and raw.strip():
                        parsed = _parse_iso_date(raw)
                        if parsed is not None:
                            return parsed
        knowledge = getattr(req, "knowledge", None)
        if isinstance(knowledge, dict):
            for key in ("knowledge_cutoff", "llm_knowledge_cutoff", "training_cutoff"):
                raw = knowledge.get(key)
                if isinstance(raw, str) and raw.strip():
                    parsed = _parse_iso_date(raw)
                    if parsed is not None:
                        return parsed

    env_raw = (os.environ.get("OAAO_LLM_KNOWLEDGE_CUTOFF") or _DEFAULT_KNOWLEDGE_CUTOFF).strip()
    parsed = _parse_iso_date(env_raw)
    return parsed if parsed is not None else date(2025, 1, 1)


def temporal_knowledge_gap(user_message: str, cutoff: date) -> bool:
    """True when the user message references a calendar period after ``cutoff``."""
    msg = (user_message or "").strip()
    if not msg:
        return False

    for match in _ISO_DATE_RE.finditer(msg):
        d = _safe_date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if d is not None and d > cutoff:
            return True

    for match in _CN_YM_RE.finditer(msg):
        year = int(match.group(1))
        month = int(match.group(2)) if match.group(2) else 1
        d = _safe_date(year, month, 1)
        if d is not None and d > cutoff:
            return True

    for match in _EN_MY_RE.finditer(msg):
        month = _MONTHS.get(match.group(1).lower(), 0)
        year = int(match.group(2))
        if month:
            d = _safe_date(year, month, 1)
            if d is not None and d > cutoff:
                return True

    for match in _BARE_YEAR_RE.finditer(msg):
        year = int(match.group(1))
        if year > cutoff.year:
            return True
        if year == cutoff.year:
            # Same calendar year — only a gap when a later month is explicit (handled above).
            continue

    return False


def knowledge_gap_context(req: object | None, *, user_message: str = "") -> dict[str, str]:
    """Template variables for ``planning.intent`` (clock + cutoff + gap flag)."""
    cutoff = resolve_llm_knowledge_cutoff(req)
    today = datetime.now(UTC).date().isoformat()
    gap = temporal_knowledge_gap(user_message, cutoff)
    return {
        "llm_knowledge_cutoff": cutoff.isoformat(),
        "current_date": today,
        "knowledge_gap_detected": "yes" if gap else "no",
    }
