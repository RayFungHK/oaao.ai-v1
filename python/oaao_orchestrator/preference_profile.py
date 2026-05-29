"""UX-1-S5 — guided survey answers → preference_tags + hidden style instruction."""

from __future__ import annotations

from typing import Any

# Option id → display tag (hash prefix included for UI chips).
_OPTION_ID_TAGS: dict[str, str] = {
    "q1_concise": "#簡潔",
    "q1_balanced": "#適中篇幅",
    "q1_detailed": "#較詳盡",
    "q1_very_detailed": "#深入說明",
    "q2_factual": "#事實導向",
    "q2_balanced": "#平衡語氣",
    "q2_creative": "#創意表達",
    "q2_playful": "#活潑語氣",
    "q3_steady": "#穩定用詞",
    "q3_mixed": "#適度變化",
    "q3_varied": "#多樣表達",
    "q4_brief": "#點到為止",
    "q4_balanced": "#適度延伸",
    "q4_thorough": "#主動展開",
    "q5_steady": "#穩健風格",
    "q5_expressive": "#熱情表達",
}

_OPTION_ID_TAGS_EN: dict[str, str] = {
    "q1_concise": "#concise",
    "q1_balanced": "#balanced-length",
    "q1_detailed": "#detailed",
    "q1_very_detailed": "#thorough",
    "q2_factual": "#factual",
    "q2_balanced": "#balanced-tone",
    "q2_creative": "#creative",
    "q2_playful": "#playful",
    "q3_steady": "#steady-wording",
    "q3_mixed": "#some-variety",
    "q3_varied": "#varied-wording",
    "q4_brief": "#brief-followup",
    "q4_balanced": "#balanced-followup",
    "q4_thorough": "#proactive-depth",
    "q5_steady": "#steady-style",
    "q5_expressive": "#expressive-style",
}

_TAG_INSTRUCTION_ZH: dict[str, str] = {
    "#簡潔": "回覆保持簡短，先給結論與要點，避免冗長鋪陳。",
    "#適中篇幅": "篇幅適中，有重點也有必要細節，避免過短或過長。",
    "#較詳盡": "在需要時補充步驟、理由與例子，但仍保持結構清楚。",
    "#深入說明": "願意深入解釋背景、步驟與取捨，協助使用者真正理解。",
    "#事實導向": "以可查證事實、步驟與結論為主，少花俏修辭。",
    "#平衡語氣": "語氣清楚務實，帶一點溫度但不誇張。",
    "#創意表達": "可提出新角度與可行想法，適合腦力激盪。",
    "#活潑語氣": "合適時語氣輕鬆、有熱情，但仍尊重情境。",
    "#穩定用詞": "用詞與結構保持一致，減少隨機換說法。",
    "#適度變化": "大致一致，偶爾換句話說以避免呆板。",
    "#多樣表達": "用詞與句式可明顯變化，避免每次套同一句型。",
    "#點到為止": "跟進與補充保持簡短，不主動延伸過多。",
    "#適度延伸": "有幫助時才適度延伸，不囉嗦。",
    "#主動展開": "願意主動補充細節、風險與下一步。",
    "#穩健風格": "整體沉穩、一致、以事實與步驟為主。",
    "#熱情表達": "整體熱情、有互動感，適合討論與發想。",
}

_TAG_INSTRUCTION_EN: dict[str, str] = {
    "#concise": "Keep replies short: lead with the takeaway, avoid rambling.",
    "#balanced-length": "Use medium length with clear structure.",
    "#detailed": "Add steps and rationale when they help.",
    "#thorough": "Explain context, steps, and trade-offs when useful.",
    "#factual": "Prioritize verifiable facts and clear steps over flair.",
    "#balanced-tone": "Be clear and practical with mild warmth.",
    "#creative": "Offer fresh angles and brainstorm-friendly ideas.",
    "#playful": "Use a lively tone when appropriate, stay respectful.",
    "#steady-wording": "Keep wording and structure consistent across turns.",
    "#some-variety": "Stay mostly consistent with occasional phrasing variety.",
    "#varied-wording": "Vary phrasing noticeably across replies.",
    "#brief-followup": "Keep follow-ups short; do not over-expand.",
    "#balanced-followup": "Follow up only when it clearly helps.",
    "#proactive-depth": "Proactively add detail, risks, and next steps.",
    "#steady-style": "Calm, consistent, fact-forward overall style.",
    "#expressive-style": "Warm, engaging tone suited to discussion.",
}


def _locale_is_zh(locale: str) -> bool:
    lo = (locale or "").lower()
    return lo.startswith("zh") or "hant" in lo or "hk" in lo


def align_guided_option_id(
    option_id: str,
    *,
    label: str = "",
    step_index: int = 0,
    option_index: int = 0,
    fallback_options: list[dict[str, Any]] | None = None,
) -> str:
    """Map LLM option ids to known ``qN_*`` skeleton ids when possible."""
    oid = str(option_id or "").strip()
    if oid in _OPTION_ID_TAGS or oid in _OPTION_ID_TAGS_EN:
        return oid
    label_s = str(label or "").strip()
    for fb in fallback_options or []:
        if not isinstance(fb, dict):
            continue
        fb_id = str(fb.get("id") or "").strip()
        fb_label = str(fb.get("label") or "").strip()
        if fb_id and (fb_id in _OPTION_ID_TAGS or fb_id in _OPTION_ID_TAGS_EN):
            if label_s and fb_label and label_s == fb_label:
                return fb_id
    if fallback_options and 0 <= option_index < len(fallback_options):
        fb_row = fallback_options[option_index]
        if isinstance(fb_row, dict):
            fb_id = str(fb_row.get("id") or "").strip()
            if fb_id in _OPTION_ID_TAGS or fb_id in _OPTION_ID_TAGS_EN:
                return fb_id
    if oid:
        return oid
    return f"q{step_index}_{option_index}"


def _tag_for_option(option_id: str, *, zh: bool) -> str | None:
    table = _OPTION_ID_TAGS if zh else _OPTION_ID_TAGS_EN
    tag = table.get(option_id)
    if tag:
        return tag
    return None


def derive_preference_profile_from_guided(
    answers: list[dict[str, Any]],
    *,
    locale: str = "en",
) -> dict[str, Any]:
    """Build tags, user-visible summary, and hidden planner/composer instruction."""
    zh = _locale_is_zh(locale)
    tags: list[str] = []
    seen: set[str] = set()
    for row in answers:
        if not isinstance(row, dict):
            continue
        oid = str(row.get("id") or "").strip()
        if not oid:
            continue
        tag = _tag_for_option(oid, zh=zh)
        if not tag or tag in seen:
            continue
        seen.add(tag)
        tags.append(tag)

    instr_table = _TAG_INSTRUCTION_ZH if zh else _TAG_INSTRUCTION_EN
    lines = [instr_table[t] for t in tags if t in instr_table]
    if zh:
        instruction = (
            "依使用者調校問卷所選風格回覆：\n" + "\n".join(f"- {ln}" for ln in lines)
            if lines
            else ""
        )
        summary = " · ".join(t.lstrip("#") for t in tags) if tags else ""
    else:
        instruction = (
            "Follow the user's style survey choices:\n" + "\n".join(f"- {ln}" for ln in lines)
            if lines
            else ""
        )
        summary = " · ".join(t.lstrip("#") for t in tags) if tags else ""

    return {
        "preference_tags": tags,
        "preference_tags_summary": summary,
        "preference_system_instruction": instruction.strip(),
    }


def preference_style_planner_append(user_personalization: dict[str, Any] | None) -> str:
    """Extra planner system text from preference profile (hidden from end-user UI)."""
    if not isinstance(user_personalization, dict):
        return ""
    instr = str(
        user_personalization.get("preference_style_instruction")
        or user_personalization.get("preference_system_instruction")
        or "",
    ).strip()
    if not instr:
        return ""
    return "\n\n--- User chat style profile (from preference survey) ---\n" + instr
