"""AUDIT-5 — legacy fast-path cues only (regex). Do not extend.

Canonical routing: ``planner_llm`` JSON (``needs_vault_rag``, ``needs_web_search``, ``slide_action``)
+ per-agent hooked prompts. These helpers remain for deterministic fallbacks when the LLM planner
does not run (see ``planner.needs_multi_agent_turn``) and for post-planner inject guards.
"""

from __future__ import annotations

import re
from typing import Any

_HANDBOOK_DOC = re.compile(
    r"\bhandbook\b|手冊|manual|regulatory\s+handbook",
    re.IGNORECASE,
)
_VOL_REF = re.compile(
    r"vol\.?\s*\d+|volume\s+\d+|第\s*[\d一二三四五六七八九十]+\s*[卷冊]",
    re.IGNORECASE,
)
_SLIDE_BUILD = re.compile(
    r"簡報|投影片|\bslide\b|\bdeck\b|presentation|\bppt\b",
    re.IGNORECASE,
)


def text_implies_slide_deck_request(text: str) -> bool:
    """User clearly asks for slides/deck (intent fallback when planning.intent LLM unavailable)."""
    s = (text or "").strip()
    return bool(s and _SLIDE_BUILD.search(s))
_TEACHING = re.compile(
    r"教學|teaching|tutorial|課程|lesson|curriculum|教案|講義",
    re.IGNORECASE,
)
_RECORD_CUES = (
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
_LOOKUP_CUES = (
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


def signals_explicit_vault_document_reference(text: str) -> bool:
    """Named handbook/manual + volume — vault RAG should run."""
    s = (text or "").strip()
    if not s:
        return False
    if not _HANDBOOK_DOC.search(s):
        return False
    if _VOL_REF.search(s):
        return True
    low = s.lower()
    return "regulatory handbook" in low


def text_signals_personal_record_lookup(text: str) -> bool:
    """Prior notes / recordings in the knowledge base (e.g. wallet usage mp3)."""
    s = (text or "").strip()
    if not s:
        return False
    low = s.lower()
    has_record = any(k in s for k in _RECORD_CUES) or "之前有" in s
    has_lookup = any(k in s for k in _LOOKUP_CUES) or "?" in s or "？" in s
    if ("錢包" in s or "wallet" in low) and (has_record or "之前" in s or "用法" in s):
        return True
    return has_record and has_lookup


def text_signals_vault_grounding(text: str) -> bool:
    """Vault RAG should run even without composer Auto Source."""
    if text_signals_personal_record_lookup(text):
        return True
    if signals_explicit_vault_document_reference(text):
        return True
    s = (text or "").strip()
    if not s:
        return False
    low = s.lower()
    if ("知識庫" in s or "vault" in low) and _HANDBOOK_DOC.search(s):
        return True
    return False


def signals_handbook_vol_slide_intent(text: str) -> bool:
    """Slide deck build + explicit handbook/volume reference (planner fast-path)."""
    s = (text or "").strip()
    if not s:
        return False
    if not _SLIDE_BUILD.search(s):
        return False
    return signals_explicit_vault_document_reference(s)


def signals_handbook_teaching_content(text: str) -> bool:
    """Handbook/vol teaching narrative in messages (outline LLM path)."""
    s = (text or "").strip()
    if not s:
        return False
    low = s.lower()
    if signals_explicit_vault_document_reference(s):
        return True
    if _TEACHING.search(s) and ("【引用" in s or "[citation" in low or "passage" in low):
        return True
    if _SLIDE_BUILD.search(s) and (
        signals_explicit_vault_document_reference(s) or _TEACHING.search(s)
    ):
        return True
    return _TEACHING.search(s) and signals_explicit_vault_document_reference(s)


def wants_handbook_teaching_outline(messages: list[dict[str, Any]] | None) -> bool:
    if not messages:
        return False
    for msg in messages:
        role = str(msg.get("role") or "").lower()
        if role not in ("user", "assistant"):
            continue
        content = msg.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        if signals_handbook_teaching_content(content):
            return True
    return False


def slide_template_selected(slide_designer_cfg: dict[str, Any] | None) -> bool:
    if not isinstance(slide_designer_cfg, dict):
        return False
    return bool(str(slide_designer_cfg.get("template_id") or "").strip())


def wants_slide_designer_inject(
    user_msg: str,
    *,
    slide_designer_cfg: dict[str, Any] | None,
    plan_handbook_vol: bool = False,
) -> bool:
    """Whether to append slide_designer when planner omitted it."""
    if slide_template_selected(slide_designer_cfg):
        return True
    if plan_handbook_vol:
        return True
    return signals_handbook_vol_slide_intent(user_msg)


def _last_user_message(messages: list[Any] | None) -> str:
    for msg in reversed(messages or []):
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role") or "").lower() != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
    return ""


def wants_multi_agent_for_slides(req: object) -> bool:
    """``needs_multi_agent_turn`` slide branch — template/continuation or structured slide+vol."""
    sd = getattr(req, "slide_designer", None)
    if isinstance(sd, dict):
        for key in ("template_id", "continuation", "regenerate_deck", "regenerate"):
            if sd.get(key):
                return True
    user_msg = _last_user_message(getattr(req, "messages", []) or [])
    return signals_handbook_vol_slide_intent(user_msg)
