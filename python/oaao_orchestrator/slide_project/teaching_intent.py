"""Detect handbook / vol teaching turns that need LLM outline (not template placeholder titles)."""

from __future__ import annotations

import re
from typing import Any


def wants_handbook_teaching_outline(messages: list[dict[str, Any]] | None) -> bool:
    """
    True when the user (or vault-injected context) targets handbook/vol teaching slides.

    Used with ``template_id``: keep imported ``pptx_master`` layout but plan titles/focus from
    handbook content instead of ``slides_spec_from_template_pages`` placeholder titles.
    """
    if not messages:
        return False
    for msg in messages:
        role = str(msg.get("role") or "").lower()
        if role not in ("user", "assistant"):
            continue
        content = msg.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        if _text_signals_handbook_teaching(content):
            return True
    return False


def text_signals_personal_record_lookup(text: str) -> bool:
    """Prior notes / recordings in the knowledge base (e.g. wallet usage mp3)."""
    s = (text or "").strip()
    if not s:
        return False
    low = s.lower()
    record_cues = (
        "記錄",
        "錄音",
        "錄製",
        "檔案",
        "文件",
        "筆記",
        "笔记",
        "stored",
        "recorded",
        "archive",
        "mp3",
        "audio",
        "wav",
    )
    lookup_cues = (
        "之前",
        "先前",
        "以前",
        "有用",
        "用法",
        "怎麼",
        "如何",
        "有没有",
        "有沒有",
        "搜",
        "找",
        "查",
    )
    has_record = any(k in s for k in record_cues) or "之前有" in s
    has_lookup = any(k in s for k in lookup_cues) or "?" in s or "？" in s
    if ("錢包" in s or "wallet" in low) and (has_record or "之前" in s or "用法" in s):
        return True
    return has_record and has_lookup


def text_signals_vault_grounding(text: str) -> bool:
    """Handbook / manual / vol mentions — vault RAG should run even without composer Auto Source."""
    if _text_signals_handbook_teaching(text):
        return True
    if text_signals_personal_record_lookup(text):
        return True
    s = (text or "").strip()
    if not s:
        return False
    low = s.lower()
    handbook = any(k in low for k in ("handbook", "手冊", "manual"))
    vol = any(k in low for k in ("vol", "volume", "vol.", "vol3", "vol.3", "冊", "卷"))
    if not vol and re.search(r"第\s*[\d一二三四五六七八九十]+\s*[卷冊]", s):
        vol = True
    if handbook and vol:
        return True
    if "regulatory handbook" in low:
        return True
    return any(k in low for k in ("知識庫", "vault")) and handbook


def _text_signals_handbook_teaching(text: str) -> bool:
    s = (text or "").strip()
    if not s:
        return False
    low = s.lower()
    handbook = any(k in low for k in ("handbook", "手冊", "manual", "vault", "知識庫"))
    vol = any(k in low for k in ("vol", "volume", "vol.", "vol3", "vol.3", "冊", "卷"))
    if not vol and re.search(r"第\s*[\d一二三四五六七八九十]+\s*[卷冊]", s):
        vol = True
    teaching = any(
        k in low
        for k in (
            "教學",
            "teaching",
            "tutorial",
            "課程",
            "lesson",
            "curriculum",
            "教案",
            "講義",
        )
    )
    slides = any(
        k in low for k in ("簡報", "投影片", "slide", "deck", "presentation", "ppt", "簡報片")
    )
    if slides and (handbook or teaching or vol):
        return True
    if teaching and (handbook or vol):
        return True
    # Citation / RAG blocks from vault often omit the word "handbook"
    if teaching and ("【引用" in s or "[citation" in low or "passage" in low):
        return True
    return False
