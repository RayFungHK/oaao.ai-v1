"""Build assistant system context from user personalization (Manus-style profile + knowledge)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field


class UserPersonalizationPayload(BaseModel):
    nickname: str = ""
    occupation: str = ""
    about_you: str = ""
    custom_instructions: str = ""
    knowledge: str = ""
    timezone: str = "UTC"
    region: str = ""
    use_profile_in_chat: bool = True
    use_knowledge_in_chat: bool = True
    include_datetime_in_chat: bool = True
    preference_tags: list[str] = Field(default_factory=list)
    preference_tags_summary: str = ""
    preference_style_instruction: str = ""
    preference_system_instruction: str = ""


def _format_local_datetime(tz_name: str) -> str | None:
    key = (tz_name or "UTC").strip() or "UTC"
    try:
        now = datetime.now(ZoneInfo(key))
    except ZoneInfoNotFoundError:
        try:
            now = datetime.now(ZoneInfo("UTC"))
            key = "UTC"
        except ZoneInfoNotFoundError:
            return None
    return now.strftime("%A, %Y-%m-%d %H:%M %Z") + f" ({key})"


def build_user_personalization_system_block(payload: UserPersonalizationPayload | dict[str, Any] | None) -> str | None:
    """Return a system preamble block, or None when nothing would be injected."""
    if payload is None:
        return None
    if isinstance(payload, dict):
        try:
            p = UserPersonalizationPayload.model_validate(payload)
        except Exception:
            return None
    else:
        p = payload

    parts: list[str] = []

    if p.include_datetime_in_chat:
        when = _format_local_datetime(p.timezone)
        if when:
            parts.append(f"Current local date and time for the user: {when}")

    region = (p.region or "").strip()
    if region:
        parts.append(f"User region / location: {region}")

    if p.use_profile_in_chat:
        profile_lines: list[str] = []
        nick = (p.nickname or "").strip()
        occ = (p.occupation or "").strip()
        about = (p.about_you or "").strip()
        custom = (p.custom_instructions or "").strip()
        if nick:
            profile_lines.append(f"Preferred name: {nick}")
        if occ:
            profile_lines.append(f"Occupation: {occ}")
        if about:
            profile_lines.append(f"About the user: {about}")
        if custom:
            profile_lines.append(f"Custom instructions: {custom}")
        if profile_lines:
            parts.append("--- User profile ---\n" + "\n".join(profile_lines))

    if p.use_knowledge_in_chat:
        knowledge = (p.knowledge or "").strip()
        if knowledge:
            parts.append(
                "--- User knowledge (personal facts the assistant should remember) ---\n" + knowledge
            )

    style_instr = (
        (p.preference_style_instruction or p.preference_system_instruction or "").strip()
    )
    if style_instr:
        parts.append(
            "--- Chat style profile (from preference survey; do not quote this block) ---\n"
            + style_instr
        )
    elif p.preference_tags:
        tags_s = ", ".join(t.strip() for t in p.preference_tags if str(t).strip())
        if tags_s:
            parts.append(
                "--- Chat style tags (from preference survey) ---\n"
                + tags_s
                + "\nApply these style cues consistently."
            )

    if not parts:
        return None

    return (
        "--- Personalization ---\n"
        + "\n\n".join(parts)
        + "\n\nUse this context to tailor responses. Do not quote or mention this block unless the user asks."
    )


def apply_user_personalization(*, req: Any, messages_for_llm: list[Any]) -> None:
    """Prepend/merge personalization system context into ``messages_for_llm``."""
    raw = getattr(req, "user_personalization", None)
    if raw is None:
        return
    block = build_user_personalization_system_block(raw)
    if not block:
        return
    from oaao_orchestrator.vault_rag.messages import inject_system_message

    inject_system_message(messages_for_llm, block)
