"""Post-turn todo candidates — LLM JSON hook (multiple tasks per turn, CS-6-S3)."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

from oaao_orchestrator.corpus.llm import chat_completion_text
from oaao_orchestrator.evaluation.productivity_post_turn import (
    format_turn_transcript,
    llm_cfg_from_chat_request,
    load_todo_post_turn_prompt,
)
from oaao_orchestrator.json_utils import extract_json_object

logger = logging.getLogger(__name__)

_ACTION_TYPE = "todo_item_suggested"
_TITLE_MAX = 120
_SNIPPET_MAX = 200
_MAX_ITEMS = 8

_META_ASSISTANT_MARKERS = (
    "knowledge-base",
    "vault search",
    "scoped or ran",
    "tool run",
    "rag ",
    "event-stream",
    "pipeline task",
)

_CHECKBOX = re.compile(r"^\s*[-*]\s*\[[ xX]\]\s+(.+)$", re.MULTILINE)
_BULLET_TASK = re.compile(
    r"^\s*(?:[-*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.{4,200})$",
    re.MULTILINE,
)
_LIST_INTRO = re.compile(
    r"(?:包含|包括|待辦(?:清單)?|清單如下|tasks?)[：:]\s*([^\n。.!；;]+)",
    re.IGNORECASE,
)
_MD_BOLD = re.compile(r"\*\*([^*]+)\*\*")


@dataclass
class TodoItemCandidate:
    title: str
    context_snippet: str
    confidence: float
    conversation_id: int
    priority: str = "normal"
    due_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "context_snippet": self.context_snippet[: _SNIPPET_MAX],
            "confidence": round(float(self.confidence), 3),
            "conversation_id": self.conversation_id,
            "priority": self.priority,
            "due_at": self.due_at,
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


def _clean_title(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    m = _MD_BOLD.search(s)
    if m:
        s = m.group(1).strip()
    s = re.sub(r"^[-*•\d.)\s]+", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > _TITLE_MAX:
        s = s[: _TITLE_MAX - 1] + "…"
    return s


def _split_enumerated_tasks(text: str) -> list[str]:
    """User lists like 「包含：A、B、C」."""
    out: list[str] = []
    seen: set[str] = set()
    for m in _LIST_INTRO.finditer(text):
        chunk = m.group(1).strip()
        for part in re.split(r"[、,，;；]\s*", chunk):
            t = _clean_title(part)
            if len(t) < 4:
                continue
            key = t.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(t)
    return out


def _extract_bullet_tasks(text: str) -> list[str]:
    lines: list[str] = []
    for m in _CHECKBOX.finditer(text):
        t = _clean_title(m.group(1))
        if t:
            lines.append(t)
    if lines:
        return lines[:_MAX_ITEMS]
    for m in _BULLET_TASK.finditer(text):
        t = _clean_title(m.group(1))
        if len(t) < 6:
            continue
        lower = t.lower()
        if re.search(r"[\u4e00-\u9fff]", t) or any(
            k in lower
            for k in (
                "todo",
                "task",
                "send",
                "review",
                "draft",
                "email",
                "整理",
                "撰寫",
                "寄",
                "提交",
                "完成",
            )
        ):
            lines.append(t)
    return lines[:_MAX_ITEMS]


def _todo_title_duplicates_open(title: str, open_todo_items: list[dict[str, Any]] | None) -> bool:
    needle = title.strip().lower()
    if len(needle) < 4 or not open_todo_items:
        return False
    for row in open_todo_items:
        if not isinstance(row, dict):
            continue
        existing = str(row.get("title") or "").strip().lower()
        if len(existing) < 4:
            continue
        if needle == existing or needle in existing or existing in needle:
            return True
    return False


def _last_user_text(messages: list[dict[str, Any]]) -> str:
    for msg in reversed(messages[-8:]):
        if not isinstance(msg, dict) or msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
    return ""


def _candidate_from_action(
    action: dict[str, Any],
    *,
    conversation_id: int,
    min_confidence: float,
    open_todo_items: list[dict[str, Any]] | None,
    default_snippet: str,
) -> TodoItemCandidate | None:
    if str(action.get("type") or "").strip() != _ACTION_TYPE:
        return None
    title = _clean_title(str(action.get("title") or ""))
    if len(title) < 4:
        return None
    if _todo_title_duplicates_open(title, open_todo_items):
        return None
    try:
        confidence = float(action.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))
    if confidence < min_confidence:
        return None
    priority = str(action.get("priority") or "normal").strip().lower()
    if priority not in ("low", "normal", "high"):
        priority = "normal"
    snippet = str(action.get("context_snippet") or default_snippet or title).strip()
    snippet = re.sub(r"\s+", " ", snippet)[:_SNIPPET_MAX]
    return TodoItemCandidate(
        title=title,
        context_snippet=snippet,
        confidence=confidence,
        conversation_id=conversation_id,
        priority=priority,
    )


def _heuristic_todo_candidates(
    *,
    conversation_id: int,
    messages: list[dict[str, Any]],
    assistant_text: str,
    min_confidence: float,
    open_todo_items: list[dict[str, Any]] | None,
) -> list[TodoItemCandidate]:
    user_tail = _last_user_text(messages)
    combined = f"{user_tail}\n{assistant_text}".strip() if user_tail else assistant_text
    if len(combined) < 16:
        return []

    titles: list[str] = []
    seen: set[str] = set()
    for source in (user_tail, combined):
        for t in _split_enumerated_tasks(source):
            key = t.lower()
            if key not in seen:
                seen.add(key)
                titles.append(t)
    if not titles:
        titles = _extract_bullet_tasks(assistant_text)
    if not titles and user_tail:
        titles = _split_enumerated_tasks(combined)

    snippet = combined[:_SNIPPET_MAX].strip()
    out: list[TodoItemCandidate] = []
    for title in titles[:_MAX_ITEMS]:
        if _todo_title_duplicates_open(title, open_todo_items):
            continue
        out.append(
            TodoItemCandidate(
                title=title,
                context_snippet=snippet,
                confidence=0.72,
                conversation_id=conversation_id,
            )
        )
    if not out:
        return []
    if len(out) == 1 and out[0].confidence < min_confidence:
        return []
    return out


def _todo_actions_from_parsed(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    actions = parsed.get("actions")
    if isinstance(actions, list):
        return [a for a in actions if isinstance(a, dict)]
    if str(parsed.get("action") or "").strip() == _ACTION_TYPE:
        return [parsed]
    return []


async def _llm_todo_candidates(
    *,
    conversation_id: int,
    messages: list[dict[str, Any]],
    assistant_text: str,
    llm_cfg: dict[str, Any],
    locale: str,
    min_confidence: float,
    open_todo_items: list[dict[str, Any]] | None,
) -> list[TodoItemCandidate]:
    user_tail = _last_user_text(messages)
    default_snippet = f"{user_tail}\n{assistant_text}".strip()[:_SNIPPET_MAX]

    system = load_todo_post_turn_prompt(
        locale=locale,
        transcript=format_turn_transcript(messages, assistant_text=assistant_text),
    )
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
        logger.exception("todo_item_post_turn_llm_failed conversation_id=%s", conversation_id)
        return []

    parsed = extract_json_object(text or "")
    if not parsed:
        return []

    out: list[TodoItemCandidate] = []
    seen_titles: set[str] = set()
    for action in _todo_actions_from_parsed(parsed):
        cand = _candidate_from_action(
            action,
            conversation_id=conversation_id,
            min_confidence=min_confidence,
            open_todo_items=open_todo_items,
            default_snippet=default_snippet,
        )
        if cand is None:
            continue
        key = cand.title.lower()
        if key in seen_titles:
            continue
        seen_titles.add(key)
        out.append(cand)
        if len(out) >= _MAX_ITEMS:
            break
    return out


async def classify_todo_item_candidates(
    *,
    conversation_id: int,
    messages: list[dict[str, Any]],
    assistant_text: str,
    min_confidence: float = 0.58,
    open_todo_items: list[dict[str, Any]] | None = None,
    llm_cfg: dict[str, Any] | None = None,
    locale: str = "",
    chat_request: object | None = None,
) -> list[TodoItemCandidate]:
    """Post-stream classifier — zero or more todos (LLM JSON actions, else heuristic split)."""
    assistant = (assistant_text or "").strip()
    if _is_tool_meta_turn(assistant):
        return []

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

    cfg = llm_cfg if _llm_ready(llm_cfg) else llm_cfg_from_chat_request(chat_request)
    if _llm_ready(cfg):
        llm_out = await _llm_todo_candidates(
            conversation_id=conversation_id,
            messages=messages,
            assistant_text=assistant,
            llm_cfg=cfg or {},
            locale=loc,
            min_confidence=min_confidence,
            open_todo_items=open_todo_items,
        )
        if llm_out:
            return llm_out

    return _heuristic_todo_candidates(
        conversation_id=conversation_id,
        messages=messages,
        assistant_text=assistant,
        min_confidence=min_confidence,
        open_todo_items=open_todo_items,
    )


def classify_todo_item_candidate(
    *,
    conversation_id: int,
    messages: list[dict[str, Any]],
    assistant_text: str,
    min_confidence: float = 0.58,
    open_todo_items: list[dict[str, Any]] | None = None,
) -> TodoItemCandidate | None:
    """Sync helper — first candidate only (tests / legacy)."""
    import asyncio

    items = asyncio.run(
        classify_todo_item_candidates(
            conversation_id=conversation_id,
            messages=messages,
            assistant_text=assistant_text,
            min_confidence=min_confidence,
            open_todo_items=open_todo_items,
        )
    )
    return items[0] if items else None
