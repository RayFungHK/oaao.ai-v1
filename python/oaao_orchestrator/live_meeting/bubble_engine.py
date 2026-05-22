"""Cadence-gated keyword / question bubbles from recent transcript (M2)."""

from __future__ import annotations

import re
import secrets
from typing import Any

CADENCE_INTERVAL_SEC: dict[str, float] = {
    "debate": 8.0,
    "1v1": 20.0,
    "meeting": 60.0,
}

_QUESTION_RE = re.compile(
    r"(?:[?？]|是不是|能否|可否|如何|怎麼|什麼|為什麼|哪裡|哪個|多少|幾|嗎|呢)\s*$"
)
_SENTENCE_SPLIT = re.compile(r"[。！？!?；;\n]+")


def cadence_interval_sec(cadence: str) -> float:
    key = (cadence or "1v1").strip().lower()
    return CADENCE_INTERVAL_SEC.get(key, CADENCE_INTERVAL_SEC["1v1"])


def _glossary_terms(glossary: dict[str, Any] | None) -> list[str]:
    if not glossary or not isinstance(glossary, dict):
        return []
    terms = glossary.get("terms")
    if not isinstance(terms, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for raw in terms:
        if not isinstance(raw, dict):
            continue
        term = str(raw.get("term") or "").strip()
        if len(term) < 2 or term in seen:
            continue
        seen.add(term)
        out.append(term)
    out.sort(key=len, reverse=True)
    return out


def _bubble_id() -> str:
    return f"bb-{secrets.token_hex(4)}"


def extract_bubbles(
    text: str,
    glossary: dict[str, Any] | None = None,
    *,
    max_bubbles: int = 5,
) -> list[dict[str, Any]]:
    """Return bubble dicts: ``{ bubble_id, bubble_type, text }``."""
    chunk = (text or "").strip()
    if len(chunk) < 6:
        return []

    seen: set[str] = set()
    out: list[dict[str, Any]] = []

    def _add(bubble_type: str, label: str) -> None:
        key = label.strip().lower()
        if len(key) < 2 or key in seen:
            return
        seen.add(key)
        out.append(
            {
                "bubble_id": _bubble_id(),
                "bubble_type": bubble_type,
                "text": label.strip(),
            }
        )

    for term in _glossary_terms(glossary):
        if term in chunk:
            _add("keyword", term)
        if len(out) >= max_bubbles:
            return out

    for sentence in _SENTENCE_SPLIT.split(chunk):
        line = sentence.strip()
        if len(line) < 4:
            continue
        if _QUESTION_RE.search(line):
            q = line if len(line) <= 80 else line[:77] + "…"
            _add("question", q)
        if len(out) >= max_bubbles:
            return out

    # Short noun-like tokens (CJK 2–8 chars) as weak keywords when glossary empty.
    if len(out) < max_bubbles:
        for m in re.finditer(r"[\u4e00-\u9fff]{2,8}", chunk):
            token = m.group(0)
            if token in seen:
                continue
            if len(token) < 3:
                continue
            _add("keyword", token)
            if len(out) >= max_bubbles:
                break

    return out[:max_bubbles]
