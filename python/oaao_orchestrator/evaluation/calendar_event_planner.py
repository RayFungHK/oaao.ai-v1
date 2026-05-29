"""CS-5 — Calendar event planner: condense title/notes before persist."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from oaao_orchestrator.corpus.llm import chat_completion_text

logger = logging.getLogger(__name__)

_TITLE_MAX = 80
_NOTES_MAX = 480

_RE_MD_HEADING = re.compile(r"^#{1,6}\s+", re.MULTILINE)
_RE_MD_BOLD = re.compile(r"\*\*([^*]+)\*\*")
_RE_MD_ITALIC = re.compile(r"\*([^*]+)\*")
_RE_MD_CODE = re.compile(r"`([^`]+)`")
_RE_MD_RULE = re.compile(r"^---+$", re.MULTILINE)


def summarize_calendar_notes(raw: str, max_len: int = _NOTES_MAX) -> str:
    """Plain-text summary (no LLM) — mirrors calendar-notes.js."""
    s = (raw or "").strip()
    if not s:
        return ""

    s = _RE_MD_HEADING.sub("", s)
    s = _RE_MD_BOLD.sub(r"\1", s)
    s = _RE_MD_ITALIC.sub(r"\1", s)
    s = _RE_MD_CODE.sub(r"\1", s)
    s = _RE_MD_RULE.sub("", s)

    paras: list[str] = []
    seen: set[str] = set()
    for p in re.split(r"\n+", s):
        t = p.strip()
        if not t:
            continue
        key = t[:120]
        if key in seen:
            continue
        seen.add(key)
        paras.append(t)
    s = " ".join(paras)
    s = re.sub(r"\s+", " ", s).strip()

    cap = max(40, int(max_len))
    if len(s) <= cap:
        return s
    return s[:cap] + "…"


def _trim_title(title: str) -> str:
    t = re.sub(r"\s+", " ", (title or "").strip())
    if not t:
        return "Scheduled event"
    if len(t) <= _TITLE_MAX:
        return t
    return t[: _TITLE_MAX - 1] + "…"


def _heuristic_plan(payload: dict[str, Any]) -> dict[str, Any]:
    title = _trim_title(str(payload.get("title") or ""))
    notes = summarize_calendar_notes(str(payload.get("notes") or ""))
    location = re.sub(r"\s+", " ", str(payload.get("location") or "").strip())[:120]
    return {
        "ok": True,
        "title": title,
        "notes": notes,
        "location": location,
        "source": "heuristic",
    }


def _extract_json_object(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        dec = json.loads(raw)
        return dec if isinstance(dec, dict) else None
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        dec = json.loads(m.group(0))
        return dec if isinstance(dec, dict) else None
    except json.JSONDecodeError:
        return None


async def _llm_plan(payload: dict[str, Any], llm_cfg: dict[str, Any]) -> dict[str, Any] | None:
    locale = str(payload.get("locale") or "en").lower()
    zh = locale.startswith("zh")
    start_at = str(payload.get("start_at") or "").strip()
    end_at = str(payload.get("end_at") or "").strip()

    system = (
        "You are a calendar event planner. Output a single JSON object only with keys "
        "title, notes, location (string). "
        f"title: max {_TITLE_MAX} characters, short event name. "
        f"notes: max {_NOTES_MAX} characters, plain text, no markdown, no duplicate paragraphs. "
        "location: keep or shorten; empty string if unknown."
    )
    if zh:
        system += " Use Traditional Chinese (zh-Hant) for title and notes when the source is Chinese."

    user = (
        f"start_at: {start_at}\n"
        f"end_at: {end_at}\n"
        f"draft_title: {str(payload.get('title') or '')[:500]}\n"
        f"draft_notes:\n{str(payload.get('notes') or '')[:4000]}\n"
        f"draft_location: {str(payload.get('location') or '')[:200]}"
    )

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            text = await chat_completion_text(
                client,
                llm_cfg=llm_cfg,
                system=system,
                user=user,
                temperature=0.2,
            )
    except Exception:
        logger.exception("calendar_event_planner_llm_failed")
        return None

    parsed = _extract_json_object(text or "")
    if not parsed:
        return None

    return {
        "ok": True,
        "title": _trim_title(str(parsed.get("title") or payload.get("title") or "")),
        "notes": summarize_calendar_notes(
            str(parsed.get("notes") or payload.get("notes") or ""),
            _NOTES_MAX,
        ),
        "location": re.sub(r"\s+", " ", str(parsed.get("location") or payload.get("location") or "").strip())[
            :120
        ],
        "source": "llm",
    }


async def run_calendar_event_planner(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Planner step between Add-to-calendar confirm and DB write.

    Uses chat LLM when ``llm_cfg`` is present; otherwise heuristic summarize only.
    """
    llm_cfg = payload.get("llm_cfg") if isinstance(payload.get("llm_cfg"), dict) else None
    if (
        llm_cfg
        and str(llm_cfg.get("base_url") or "").strip()
        and str(llm_cfg.get("model") or "").strip()
    ):
        planned = await _llm_plan(payload, llm_cfg)
        if planned is not None:
            return planned

    return _heuristic_plan(payload)
