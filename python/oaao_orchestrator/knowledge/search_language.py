"""Map user / orientation BCP47 tags to SearXNG ``language`` query parameter."""

from __future__ import annotations

import os
import re

# SearXNG sxng locale tags (subset — see searx/sxng_locales.py).
_SEARXNG_LOCALE_RE = re.compile(r"^[a-z]{2}(-[A-Za-z]{2})?$")


def _normalize_bcp47(raw: str) -> str:
    return (raw or "").strip().replace("_", "-")


def bcp47_to_searxng_language(tag: str) -> str | None:
    """
    Convert display / orientation locale to a SearXNG ``language`` code.

    Returns None when the tag is empty or should not constrain search (instance default).
    """
    norm = _normalize_bcp47(tag)
    if not norm:
        return None
    low = norm.lower()

    if low in ("zh-hant", "zh-tw", "zh-hk", "zh-mo"):
        return "zh-TW"
    if low in ("zh-hans", "zh-cn", "zh-sg"):
        return "zh-CN"
    if low == "zh":
        return "zh-CN"
    if low.startswith("en"):
        return "en"
    if low.startswith("ja"):
        return "ja"
    if low.startswith("ko"):
        return "ko"
    if low.startswith("fr"):
        return "fr"
    if low.startswith("de"):
        return "de"
    if low.startswith("es"):
        return "es"
    if low.startswith("pt"):
        return "pt"
    if low.startswith("it"):
        return "it"
    if low.startswith("ru"):
        return "ru"
    if low.startswith("th"):
        return "th"
    if low.startswith("vi"):
        return "vi"
    if low.startswith("id"):
        return "id"
    if low.startswith("ms"):
        return "ms"
    if low.startswith("ar"):
        return "ar"

    if _SEARXNG_LOCALE_RE.match(norm):
        parts = norm.split("-", 1)
        if len(parts) == 2:
            return f"{parts[0].lower()}-{parts[1].upper()}"
        return parts[0].lower()

    return None


def resolve_searxng_language(
    *,
    display_locale: str | None = None,
    orientation_language: str | None = None,
    env_override: str | None = None,
) -> str | None:
    """
    Preference order: env ``OAAO_WEB_SEARCH_LANGUAGE`` → display locale → orientation language.
    """
    env_raw = (env_override if env_override is not None else os.environ.get("OAAO_WEB_SEARCH_LANGUAGE") or "").strip()
    if env_raw:
        mapped = bcp47_to_searxng_language(env_raw)
        if mapped:
            return mapped

    for candidate in (display_locale, orientation_language):
        mapped = bcp47_to_searxng_language(candidate or "")
        if mapped:
            return mapped
    return None
