"""LLM summary for research articles."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

from oaao_orchestrator.asr_common import _resolve_secret, openai_compat_chat_url

logger = logging.getLogger(__name__)


_LANG_LABELS: dict[str, str] = {
    "zh-hant": "Traditional Chinese (繁體中文)",
    "zh-hans": "Simplified Chinese (简体中文)",
    "en": "English",
    "ja": "Japanese (日本語)",
    "ko": "Korean (한국어)",
    "yue": "Cantonese (粵語)",
}


_FALLBACK_NOTICES: dict[str, str] = {
    "zh-hant": "> ⚠️ **未使用 AI 摘要**：請在「設定 → 用途分配」指派 **Research summary** LLM，或確認 LLM 連線正常。以下為原文摘錄，非完整摘要。",
    "zh-hans": "> ⚠️ **未使用 AI 摘要**：请在「设置 → 用途分配」指派 **Research summary** LLM，或确认 LLM 连接正常。以下为原文摘录，非完整摘要。",
    "en": "> ⚠️ **AI summary unavailable**: assign a **Research summary** LLM under Settings → Purpose allocation, or check LLM connectivity. Excerpt below is not a full summary.",
}


_SUMMARY_HEADINGS: dict[str, str] = {
    "zh-hant": "摘要",
    "zh-hans": "摘要",
    "en": "Summary",
    "ja": "要約",
    "ko": "요약",
    "yue": "摘要",
}


@dataclass(frozen=True)
class SummaryResult:
    text: str

    mode: str  # llm | fallback

    reason: str | None = None


def normalize_summary_language(language: str) -> str:

    raw = (language or "zh-Hant").strip().lower().replace("_", "-")

    if raw in ("zh-tw", "zh-hk", "zh-hant"):
        return "zh-hant"

    if raw in ("zh-cn", "zh-hans", "zh"):
        return "zh-hans"

    if raw.startswith("en"):
        return "en"

    if raw.startswith("ja"):
        return "ja"

    if raw.startswith("ko"):
        return "ko"

    if raw in ("yue", "zh-yue"):
        return "yue"

    return raw if raw in _LANG_LABELS else "zh-hant"


def article_body_for_summary(body_markdown: str) -> str:
    """Strip vault frontmatter and duplicate title before LLM / fallback."""

    text = (body_markdown or "").strip()

    if not text:
        return ""

    if text.startswith("---"):
        end = text.find("\n---", 3)

        if end != -1:
            text = text[end + 4 :].lstrip()

    lines: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()

        if not stripped:
            if lines and lines[-1] != "":
                lines.append("")

            continue

        if re.match(r"^(title|source_url|content_url)\s*:", stripped, re.I):
            continue

        if stripped.startswith("#") and len(stripped) < 240:  # noqa: SIM102
            # Drop lone duplicate H1 right after frontmatter.

            if not lines:
                continue

        lines.append(line.rstrip())

    cleaned = "\n".join(lines).strip()

    return cleaned or (body_markdown or "").strip()


def _extract_abstract_excerpt(body: str, *, max_chars: int = 1800) -> str:

    if not body.strip():
        return ""

    patterns = (
        r"(?is)(?:^|\n)#+\s*abstract\s*\n+(.*?)(?:\n#+\s|\Z)",
        r"(?is)(?:^|\n)abstract\s*[.:]\s*\n+(.*?)(?:\n#+\s|\n\n[A-Z][a-z]+|\Z)",
    )

    for pat in patterns:
        m = re.search(pat, body)

        if not m:
            continue

        chunk = re.sub(r"\s+", " ", m.group(1)).strip()

        if len(chunk) >= 80:
            return chunk[:max_chars].strip()

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]

    for para in paragraphs:
        plain = re.sub(r"\s+", " ", para).strip()

        if len(plain) >= 120 and not plain.startswith("#"):
            return plain[:max_chars].strip()

    compact = re.sub(r"\s+", " ", body).strip()

    return compact[:max_chars].strip()


def _language_label(lang_key: str) -> str:

    return _LANG_LABELS.get(lang_key, lang_key)


def _summary_heading(lang_key: str) -> str:

    return _SUMMARY_HEADINGS.get(lang_key, "Summary")


def _fallback_notice(lang_key: str) -> str:

    return _FALLBACK_NOTICES.get(lang_key, _FALLBACK_NOTICES["en"])


def _build_system_prompt(lang_key: str) -> str:

    label = _language_label(lang_key)

    heading = _summary_heading(lang_key)

    return (
        f"You summarize academic papers and technical articles for a knowledge vault. "
        f"Write entirely in {label}.\n\n"
        "Requirements:\n"
        f"- Start with `## {heading}`\n"
        "- Explain in plain language: (1) research problem / motivation, (2) main method or approach, "
        "(3) key results or findings, (4) limitations or significance if stated\n"
        "- Use Markdown bullet points; keep 6–12 bullets total\n"
        "- Do not copy metadata lines (title:, source_url:, content_url:)\n"
        "- Do not paste long verbatim quotes from the source\n"
        "- Do not invent facts not supported by the article text"
    )


def _build_user_prompt(title: str, body: str) -> str:

    title_line = title.strip() or "Untitled"

    clipped = body[:24000]

    return f"Paper title: {title_line}\n\nArticle text (markdown):\n\n{clipped}"


def _fallback_summary(body_markdown: str, *, language: str, reason: str) -> SummaryResult:

    lang_key = normalize_summary_language(language)

    body = article_body_for_summary(body_markdown)

    excerpt = _extract_abstract_excerpt(body)

    heading = _summary_heading(lang_key)

    notice = _fallback_notice(lang_key)

    if excerpt:  # noqa: SIM108
        text = f"{notice}\n\n## {heading}\n\n{excerpt}"

    else:
        text = f"{notice}\n\n## {heading}\n\n—"

    logger.warning("research summary fallback (%s): %s", reason, lang_key)

    return SummaryResult(text=text, mode="fallback", reason=reason)


async def summarize_markdown(
    client: httpx.AsyncClient,
    *,
    body_markdown: str,
    language: str,
    llm_cfg: dict[str, Any] | None,
    title: str = "",
) -> SummaryResult:

    lang_key = normalize_summary_language(language)

    article_body = article_body_for_summary(body_markdown)

    if not article_body.strip():
        return _fallback_summary(body_markdown, language=language, reason="empty_body")

    if not llm_cfg or not isinstance(llm_cfg, dict):
        return _fallback_summary(body_markdown, language=language, reason="missing_llm_binding")

    bu = str(llm_cfg.get("base_url") or "").strip()

    model = str(llm_cfg.get("model") or "").strip()

    if not bu or not model:
        return _fallback_summary(body_markdown, language=language, reason="incomplete_llm_binding")

    api_key = _resolve_secret(
        llm_cfg.get("api_key_env") if isinstance(llm_cfg.get("api_key_env"), str) else None
    )

    url = openai_compat_chat_url(bu)

    headers: dict[str, str] = {"Content-Type": "application/json"}

    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": _build_system_prompt(lang_key)},
            {"role": "user", "content": _build_user_prompt(title, article_body)},
        ],
        "temperature": 0.3,
        "stream": False,
    }

    try:
        r = await client.post(
            url, headers=headers, json=body, timeout=httpx.Timeout(120.0, connect=15.0)
        )

        if r.status_code >= 400:
            logger.warning("research summary llm http %s: %s", r.status_code, (r.text or "")[:300])

            return _fallback_summary(
                body_markdown,
                language=language,
                reason=f"llm_http_{r.status_code}",
            )

        data = r.json()

        if isinstance(data, dict):
            choices = data.get("choices")

            if isinstance(choices, list) and choices:
                msg = choices[0].get("message") if isinstance(choices[0], dict) else None

                if isinstance(msg, dict):
                    content = msg.get("content")

                    if isinstance(content, str) and content.strip():
                        return SummaryResult(text=content.strip(), mode="llm", reason=None)

        return _fallback_summary(body_markdown, language=language, reason="empty_llm_response")

    except Exception as exc:  # noqa: BLE001
        logger.warning("research summary failed: %s", exc)

        return _fallback_summary(body_markdown, language=language, reason="llm_exception")
