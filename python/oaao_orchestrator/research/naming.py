"""Resolve article titles and vault filenames for Research fetch."""

from __future__ import annotations

import re
from urllib.parse import urlparse

_GENERIC_TITLES = frozenset(
    {
        "introduction",
        "abstract",
        "conclusion",
        "overview",
        "home",
        "article",
        "untitled",
        "document",
        "page",
        "blog",
        "news",
        "post",
        "section",
        "chapter",
        "readme",
    },
)


def _slug(s: str, max_len: int = 80) -> str:
    raw = re.sub(r"[^\w\s-]+", "", s, flags=re.UNICODE)
    raw = re.sub(r"[\s_-]+", "-", raw).strip("-").lower()
    if not raw:
        raw = "article"
    return raw[:max_len]


def is_weak_title(title: str) -> bool:
    t = _slug(title, max_len=200)
    if not t or t in _GENERIC_TITLES:
        return True
    if len(t) <= 3:
        return True
    if re.fullmatch(r"\d+(?:-\w+)?", t):
        return True
    return False


def arxiv_id_from_url(url: str) -> str:
    m = re.search(
        r"arxiv\.org/(?:abs|pdf|html)/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)",
        url or "",
        re.I,
    )
    return m.group(1).lower() if m else ""


def title_from_markdown(markdown: str) -> str:
    md = markdown or ""
    for line in md.splitlines():
        stripped = line.strip()
        if stripped.lower().startswith("title:"):
            return stripped.split(":", 1)[1].strip()
    for line in md.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        text = re.sub(r"^#+\s*", "", stripped).strip()
        text = re.sub(r"^\d+(?:\.\d+)*\s+", "", text).strip()
        if text and not is_weak_title(text):
            return text
    return ""


def title_from_url(url: str) -> str:
    path = urlparse(url or "").path.rstrip("/")
    if not path:
        return ""
    segment = path.rsplit("/", 1)[-1]
    segment = re.sub(r"\.(html?|md|pdf)$", "", segment, flags=re.I)
    segment = segment.replace("_", " ").replace("-", " ").strip()
    return segment if segment and not is_weak_title(segment) else ""


def resolve_article_title(
    title: str,
    *,
    title_hint: str = "",
    url: str = "",
    markdown: str = "",
    fallback: str = "",
) -> str:
    candidates = [
        (title or "").strip(),
        title_from_markdown(markdown),
        (title_hint or "").strip(),
        (fallback or "").strip(),
        title_from_url(url),
    ]
    for candidate in candidates:
        if candidate and not is_weak_title(candidate):
            return candidate
    for candidate in candidates:
        if candidate:
            return candidate
    aid = arxiv_id_from_url(url)
    if aid:
        return f"arXiv {aid}"
    return "article"


def filename_slug(title: str, url: str, *, max_len: int = 80) -> str:
    base = _slug(title, max_len=max_len)
    aid = arxiv_id_from_url(url)
    if aid:
        suffix = _slug(aid.replace(".", "-"))
        if suffix and suffix not in base:
            if is_weak_title(title) or base in _GENERIC_TITLES:
                base = f"arxiv-{suffix}"
            else:
                base = _slug(f"{title} {aid}", max_len=max_len)
        return base[:max_len]

    if is_weak_title(title):
        url_slug = _slug(title_from_url(url), max_len=40)
        if url_slug and url_slug not in _GENERIC_TITLES:
            return url_slug[:max_len]

    host = urlparse(url or "").netloc.replace("www.", "")
    host_slug = _slug(host.split(".")[0], max_len=20)
    if is_weak_title(title) and host_slug and host_slug not in _GENERIC_TITLES:
        return f"{host_slug}-{base}"[:max_len]

    return base[:max_len]
