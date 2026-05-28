"""Rule-based transcript punctuation — rules live in ``python/config/quick_punctuate_rules.json``."""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

_DEFAULT_RULES: dict[str, Any] = {
    "punctuation_marks": "，。！？、；：,.!?",
    "comma_before_words": [],
    "question_patterns": [],
    "default_terminal": "。",
}


def _rules_path() -> Path:
    env = os.environ.get("OAAO_QUICK_PUNCTUATE_RULES_JSON", "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[1] / "config" / "quick_punctuate_rules.json"


@lru_cache(maxsize=1)
def load_quick_punctuate_rules() -> dict[str, Any]:
    path = _rules_path()
    if not path.is_file():
        return dict(_DEFAULT_RULES)
    try:
        with path.open(encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return dict(_DEFAULT_RULES)
    if not isinstance(raw, dict):
        return dict(_DEFAULT_RULES)
    merged = dict(_DEFAULT_RULES)
    merged.update(raw)
    return merged


def _normalize_transcript_spacing(text: str) -> str:
    s = (text or "").strip()
    if not s:
        return s
    # Drop spaces only between CJK characters; keep Latin word gaps (ai, llm, kv).
    s = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", s)
    return re.sub(r"\s+", " ", s).strip()


def quick_punctuate_transcript(text: str, rules: dict[str, Any] | None = None) -> str:
    cfg = rules if isinstance(rules, dict) else load_quick_punctuate_rules()
    marks = str(cfg.get("punctuation_marks") or _DEFAULT_RULES["punctuation_marks"])
    s = _normalize_transcript_spacing(text)
    if not s:
        return s

    for word in cfg.get("comma_before_words") or []:
        token = str(word or "").strip()
        if not token:
            continue
        s = re.sub(
            rf"(?<![{re.escape(marks)}]){re.escape(token)}",
            f"，{token}",
            s,
        )

    for row in cfg.get("question_patterns") or []:
        if not isinstance(row, dict):
            continue
        pattern = str(row.get("regex") or "").strip()
        replacement = str(row.get("replacement") or "")
        if not pattern:
            continue
        try:
            s = re.sub(pattern, replacement, s)
        except re.error:
            continue

    terminal = str(cfg.get("default_terminal") or _DEFAULT_RULES["default_terminal"])
    if not re.search(rf"[{re.escape(marks)}]$", s):
        s += terminal
    return s


def punctuation_score(text: str) -> int:
    marks = str(_DEFAULT_RULES["punctuation_marks"])
    return len(re.findall(rf"[{re.escape(marks)}]", text or ""))


def sentence_break_score(text: str) -> int:
    return len(re.findall(r"[。！？?]", text or ""))


def finalize_polish_output(polished: str, display_raw: str) -> str:
    """
    Accept LLM polish when well-formed; use quick_punctuate only as fallback.

    Gemma-class models can polish well when prompted like a chat rewrite task.
    Rules apply only when LLM truncates or returns unpunctuated run-on text.
    """
    pol = (polished or "").strip()
    raw = (display_raw or "").strip()
    min_ratio = 0.72

    if pol and raw:
        threshold = max(12, int(len(raw) * min_ratio))
        if len(pol) < threshold:
            # Concise LLM polish is often much shorter than run-on ASR — keep when well-formed.
            if sentence_break_score(pol) >= 2:
                return pol
            pol = ""

    if pol and sentence_break_score(pol) >= 2:
        return pol
    if pol and punctuation_score(pol) >= 2 and (not raw or len(pol) >= int(len(raw) * min_ratio)):
        return pol

    base = pol if pol else raw
    if not base:
        return ""

    out = quick_punctuate_transcript(base)
    if pol and raw and sentence_break_score(out) <= 1 and len(raw) > len(pol):
        alt = quick_punctuate_transcript(raw)
        if sentence_break_score(alt) > sentence_break_score(out):
            out = alt
    return out
