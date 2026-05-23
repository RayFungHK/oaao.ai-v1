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
    r"(?:[?？]|是不是|能否|可否|如何|怎麼|怎么|什麼|什么|為什麼|为什么|哪裡|哪里|哪個|哪个|多少|幾|几|嗎|吗|呢)\s*$"
)
_SENTENCE_SPLIT = re.compile(r"[。！？!?；;\n]+")
_LATIN_TOKEN_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9]{0,15}(?:\.[A-Za-z0-9]{1,15})*\b")
_DIGIT_TOKEN_RE = re.compile(r"\d{2,}")
_CJK_NUMERAL_ONLY_RE = re.compile(r"^[一二三四五六七八九十百千万萬零〇兩两]+$")
_INTENT_RES = (
    re.compile(
        r"我要\s*([A-Za-z][A-Za-z0-9]{0,15}(?:\.[\sA-Za-z0-9]{1,15})*)\s*(?:教[學习]|教程)?",
        re.IGNORECASE,
    ),
    re.compile(r"我要\s*([\u4e00-\u9fff]{2,12})\s*(?:教[學习]|教程)?"),
    re.compile(r"(?:想|要)(?:搵|找|寻|尋|查)\s*(.+?)(?:[。！？!?；;]|$)"),
    re.compile(r"(?:點樣|怎样|如何)(?:可以)?(?:搵|找|寻|尋|查)\s*(.+?)(?:[。！？!?；;]|$)"),
)
_CJK_STOPWORDS = frozenset(
    {
        "我想",
        "知道",
        "而家",
        "现在",
        "可以",
        "點樣",
        "怎样",
        "你好",
        "聽到",
        "听到",
        "在哪",
        "哪里",
        "今天",
        "我们",
        "我們",
        "客户",
        "客戶",
        "另外",
        "还有",
        "還有",
        "怎么",
        "怎麼",
        "什么",
        "什麼",
        "Teaching",
    }
)


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

    for pattern in _INTENT_RES:
        for match in pattern.finditer(chunk):
            label = (match.group(1) or "").strip(" ，,。！？!?；;")
            if len(label) >= 2:
                _add("keyword", label)
            if len(out) >= max_bubbles:
                return out

    for match in _LATIN_TOKEN_RE.finditer(chunk):
        token = match.group(0).strip(". ")
        if len(token) >= 2:
            _add("keyword", token)
        if len(out) >= max_bubbles:
            return out

    for match in _DIGIT_TOKEN_RE.finditer(chunk):
        _add("keyword", match.group(0))
        if len(out) >= max_bubbles:
            return out

    for sentence in _SENTENCE_SPLIT.split(chunk):
        line = sentence.strip()
        if len(line) < 4:
            continue
        if _QUESTION_RE.search(line) and len(out) < max_bubbles:
            q = line if len(line) <= 80 else line[:77] + "…"
            _add("question", q)
        if len(out) >= max_bubbles:
            return out

    # Weak CJK spans — skip common fillers and spoken-digit-only tokens.
    if len(out) < max_bubbles:
        for m in re.finditer(r"[\u4e00-\u9fff]{2,8}", chunk):
            token = m.group(0)
            if token in seen or token in _CJK_STOPWORDS:
                continue
            if len(token) < 3 or _CJK_NUMERAL_ONLY_RE.fullmatch(token):
                continue
            if any(token in b["text"] or b["text"] in token for b in out):
                continue
            _add("keyword", token)
            if len(out) >= max_bubbles:
                break

    return out[:max_bubbles]
