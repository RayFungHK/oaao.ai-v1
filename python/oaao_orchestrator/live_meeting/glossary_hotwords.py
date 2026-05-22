"""Build DashScope Fun-ASR hotword lists from workspace glossary."""

from __future__ import annotations

import json
from typing import Any


def hotwords_from_glossary(glossary: dict[str, Any] | None, *, max_terms: int = 200) -> list[str]:
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
        if not term or term in seen:
            continue
        seen.add(term)
        out.append(term)
        if len(out) >= max_terms:
            break
    return out


def hotwords_json_for_dashscope(glossary: dict[str, Any] | None) -> str | None:
    words = hotwords_from_glossary(glossary)
    if not words:
        return None
    return json.dumps(words, ensure_ascii=False)
