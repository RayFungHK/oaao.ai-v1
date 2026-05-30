"""Post-turn calendar event candidate — LLM JSON hook after chat (CS-5-S4)."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from oaao_orchestrator.corpus.llm import chat_completion_text
from oaao_orchestrator.evaluation.calendar_event_planner import summarize_calendar_notes
from oaao_orchestrator.evaluation.productivity_post_turn import (
    format_turn_transcript,
    llm_cfg_for_post_turn,
    load_calendar_post_turn_prompt,
)
from oaao_orchestrator.productivity_context import productivity_template_variables
from oaao_orchestrator.json_utils import extract_json_object

logger = logging.getLogger(__name__)

_ACTION_TYPE = "calendar_event_suggested"
_TITLE_MAX = 80

_META_ASSISTANT_MARKERS = (
    "knowledge-base",
    "vault search",
    "scoped or ran",
    "tool run",
    "rag ",
    "event-stream",
    "pipeline task",
    "checklist item",
    "micro-skill",
)


@dataclass
class CalendarEventCandidate:
    title: str
    start_at: str
    end_at: str
    all_day: bool
    timezone: str
    location: str
    notes: str
    confidence: float
    conversation_id: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "start_at": self.start_at,
            "end_at": self.end_at,
            "all_day": self.all_day,
            "timezone": self.timezone,
            "location": self.location,
            "notes": self.notes[:800],
            "confidence": round(float(self.confidence), 3),
            "conversation_id": self.conversation_id,
        }


def _is_tool_meta_turn(assistant_text: str) -> bool:
    lower = assistant_text.strip().lower()
    if len(lower) < 8:
        return True
    return any(m in lower for m in _META_ASSISTANT_MARKERS)


def _llm_ready(llm_cfg: dict[str, Any] | None) -> bool:
    return bool(
        llm_cfg
        and str(llm_cfg.get("base_url") or "").strip()
        and str(llm_cfg.get("model") or "").strip()
    )


def _parse_iso_z(raw: str) -> datetime | None:
    s = (raw or "").strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    except ValueError:
        return None


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _trim_title(title: str) -> str:
    t = re.sub(r"\s+", " ", (title or "").strip())
    if not t:
        return "Scheduled event"
    if len(t) <= _TITLE_MAX:
        return t
    return t[: _TITLE_MAX - 1] + "…"


def _calendar_actions_from_parsed(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    actions = parsed.get("actions")
    if isinstance(actions, list):
        return [a for a in actions if isinstance(a, dict)]
    action = str(parsed.get("action") or "").strip()
    if action == _ACTION_TYPE:
        return [parsed]
    return []


def _candidate_from_action(
    action: dict[str, Any],
    *,
    conversation_id: int,
    min_confidence: float,
) -> CalendarEventCandidate | None:
    if str(action.get("type") or "").strip() != _ACTION_TYPE:
        return None

    try:
        confidence = float(action.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))
    if confidence < min_confidence:
        return None

    start = _parse_iso_z(str(action.get("start_at") or ""))
    if start is None:
        return None

    end = _parse_iso_z(str(action.get("end_at") or ""))
    if end is None or end <= start:
        end = start + timedelta(hours=1)

    title = _trim_title(str(action.get("title") or ""))
    notes = summarize_calendar_notes(str(action.get("notes") or ""), 400)
    location = re.sub(r"\s+", " ", str(action.get("location") or "").strip())[:120]
    all_day = bool(action.get("all_day"))
    timezone = str(action.get("timezone") or "UTC").strip() or "UTC"

    return CalendarEventCandidate(
        title=title,
        start_at=_iso_z(start),
        end_at=_iso_z(end),
        all_day=all_day,
        timezone=timezone,
        location=location,
        notes=notes,
        confidence=confidence,
        conversation_id=conversation_id,
    )


async def _llm_classify_calendar_event(
    *,
    conversation_id: int,
    messages: list[dict[str, Any]],
    assistant_text: str,
    llm_cfg: dict[str, Any],
    locale: str,
    min_confidence: float,
    template_ref: str | None = None,
    chat_request: object | None = None,
) -> CalendarEventCandidate | None:
    transcript = format_turn_transcript(messages, assistant_text=assistant_text)
    ctx_vars = {
        "locale": locale,
        "transcript": transcript,
        "current_date": datetime.now(UTC).strftime("%Y-%m-%d"),
        **productivity_template_variables(chat_request),
    }
    if template_ref:
        from oaao_orchestrator.prompt_template import load_template_body, prompts_subdir, render_template_text

        body = load_template_body(ref=template_ref, search_dirs=(prompts_subdir("productivity"),))
        system = render_template_text(
            body or load_calendar_post_turn_prompt(**ctx_vars),
            ctx_vars,
        )
    else:
        system = load_calendar_post_turn_prompt(**ctx_vars)
    user = "Return the JSON object for this turn."

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            text = await chat_completion_text(
                client,
                llm_cfg=llm_cfg,
                system=system,
                user=user,
                temperature=0.1,
            )
    except Exception:
        logger.exception("calendar_event_post_turn_llm_failed conversation_id=%s", conversation_id)
        return None

    parsed = extract_json_object(text or "")
    if not parsed:
        return None

    for action in _calendar_actions_from_parsed(parsed):
        cand = _candidate_from_action(
            action,
            conversation_id=conversation_id,
            min_confidence=min_confidence,
        )
        if cand is not None:
            return cand
    return None


async def classify_calendar_event_candidate(
    *,
    conversation_id: int,
    messages: list[dict[str, Any]],
    assistant_text: str,
    min_confidence: float = 0.62,
    llm_cfg: dict[str, Any] | None = None,
    locale: str = "",
    chat_request: object | None = None,
    template_ref: str | None = None,
) -> CalendarEventCandidate | None:
    """Post-stream classifier — LLM JSON only (registry template via ``post_turn_action.register``)."""
    assistant = (assistant_text or "").strip()
    if len(assistant) < 12 or _is_tool_meta_turn(assistant):
        return None

    loc = (locale or "").strip()
    if not loc:
        for msg in reversed(messages[-4:]):
            if isinstance(msg, dict) and msg.get("role") == "user":
                content = str(msg.get("content") or "")
                if re.search(r"[\u4e00-\u9fff]", content):
                    loc = "zh-Hant"
                    break
        if not loc:
            loc = "en"

    cfg = llm_cfg if _llm_ready(llm_cfg) else llm_cfg_for_post_turn(chat_request, "calendar")
    if not _llm_ready(cfg):
        logger.debug(
            "calendar_event_post_turn skipped — no LLM endpoint conversation_id=%s",
            conversation_id,
        )
        return None

    return await _llm_classify_calendar_event(
        conversation_id=conversation_id,
        messages=messages,
        assistant_text=assistant,
        llm_cfg=cfg or {},
        locale=loc,
        min_confidence=min_confidence,
        template_ref=template_ref,
        chat_request=chat_request,
    )
