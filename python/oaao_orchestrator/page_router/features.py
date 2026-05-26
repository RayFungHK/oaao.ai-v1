"""HTML feature extraction for page classification (token-light)."""

from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import urlparse

_USER_AGENT = "OAAO-PageRouter/1.0"

_NAV_PATH_RE = re.compile(
    r"/(about|contact|login|signup|register|privacy|terms|tag|tags|category|categories|author|search|archive|feed|rss)(/|$)",
    re.I,
)


def extract_page_features(html: str, url: str, *, max_links: int = 40) -> dict[str, Any]:
    """Extract lightweight structural features from HTML."""
    text = html.replace("\r", "")
    title = _first_group(text, r"<title[^>]*>([^<]+)</title>") or ""
    h1 = _first_group(text, r"<h1[^>]*>([^<]{1,200})</h1>") or ""
    meta_desc = _meta_content(text, "description")
    og_type = _meta_content(text, "og:type") or _meta_property(text, "og:type")

    links = _extract_links(text, url, limit=max_links)
    same_domain = [ln for ln in links if ln.get("same_domain")]
    p_words = _count_tag_words(text, "p")
    article_words = _count_tag_words(text, "article")
    li_count = len(re.findall(r"<li\b", text, re.I))
    text_len = max(1, len(re.sub(r"<[^>]+>", " ", text)))
    link_density = len(links) / text_len * 1000.0

    parsed = urlparse(url)
    path_parts = [p for p in (parsed.path or "").split("/") if p]
    url_depth = len(path_parts)

    return {
        "url": url,
        "title": _clean_ws(title),
        "h1": _clean_ws(h1),
        "meta_description": _clean_ws(meta_desc)[:400],
        "og_type": (og_type or "").lower()[:40],
        "link_count": len(links),
        "same_domain_link_count": len(same_domain),
        "links_sample": links[:max_links],
        "p_word_count": p_words,
        "article_word_count": article_words,
        "li_count": li_count,
        "link_density": round(link_density, 3),
        "url_depth": url_depth,
        "html_hash": hashlib.sha256(text[:50000].encode("utf-8", errors="replace")).hexdigest(),
        "headings": _headings_sample(text, limit=6),
    }


def score_index_vs_article(features: dict[str, Any]) -> tuple[str, float, str]:
    """L1 feature scoring — returns (page_type, confidence, reason)."""
    url = str(features.get("url") or "").lower()
    og = str(features.get("og_type") or "").lower()
    p_words = int(features.get("p_word_count") or 0)
    article_words = int(features.get("article_word_count") or 0)
    link_count = int(features.get("link_count") or 0)
    same_domain = int(features.get("same_domain_link_count") or 0)
    li_count = int(features.get("li_count") or 0)
    link_density = float(features.get("link_density") or 0)
    url_depth = int(features.get("url_depth") or 0)

    index_score = 0.0
    article_score = 0.0
    reasons: list[str] = []

    if og == "article":
        article_score += 0.45
        reasons.append("og:article")
    elif og in ("website", "blog"):
        index_score += 0.15

    if article_words > 400:
        article_score += 0.35
        reasons.append("long article body")
    elif p_words > 800 and link_count < 25:
        article_score += 0.25
        reasons.append("long paragraphs, few links")

    if same_domain >= 12 and p_words < 600:
        index_score += 0.35
        reasons.append("many same-domain links, short body")
    if li_count >= 8 and same_domain >= 6:
        index_score += 0.2
        reasons.append("list-like structure")
    if link_density > 8 and p_words < 500:
        index_score += 0.2
        reasons.append("high link density")

    if url_depth >= 3 and p_words > 300 and same_domain < 8:
        article_score += 0.15
        reasons.append("deep URL + body")
    if url_depth <= 1 and same_domain >= 8:
        index_score += 0.15
        reasons.append("shallow URL + many links")

    if "/list/" in url or "/recent" in url or "/archive" in url:
        index_score += 0.4
        reasons.append("URL list/archive pattern")

    if article_score > index_score:
        conf = min(0.92, 0.45 + (article_score - index_score))
        return "article", conf, "; ".join(reasons) or "article-like features"
    if index_score > article_score:
        conf = min(0.92, 0.45 + (index_score - article_score))
        return "index", conf, "; ".join(reasons) or "index-like features"
    return "unknown", 0.4, "ambiguous features"


def is_nav_link(url: str, anchor: str = "") -> bool:
    u = (url or "").lower()
    a = (anchor or "").lower()
    if _NAV_PATH_RE.search(u):
        return True
    nav_words = ("about", "contact", "login", "sign up", "privacy", "terms", "home", "menu")
    return any(w in a for w in nav_words)


def _extract_links(html: str, base_url: str, *, limit: int) -> list[dict[str, str | bool]]:
    from urllib.parse import urljoin

    base_host = urlparse(base_url).netloc.lower()
    seen: set[str] = set()
    out: list[dict[str, str | bool]] = []
    for m in re.finditer(r'<a\b[^>]*\bhref=["\']([^"\']+)["\'][^>]*>([\s\S]{0,120}?)</a>', html, re.I):
        href = m.group(1).strip()
        if not href or href.startswith("#") or href.lower().startswith(("javascript:", "mailto:")):
            continue
        full = urljoin(base_url, href).split("#")[0].rstrip("/")
        if full in seen:
            continue
        seen.add(full)
        anchor = _clean_ws(re.sub(r"<[^>]+>", " ", m.group(2)))
        host = urlparse(full).netloc.lower()
        out.append(
            {
                "url": full,
                "anchor": anchor[:120],
                "same_domain": host == base_host,
            }
        )
        if len(out) >= limit:
            break
    return out


def _headings_sample(html: str, *, limit: int) -> list[str]:
    out: list[str] = []
    for tag in ("h1", "h2", "h3"):
        for m in re.finditer(rf"<{tag}[^>]*>([^<]{{1,160}})</{tag}>", html, re.I):
            t = _clean_ws(m.group(1))
            if t:
                out.append(t)
            if len(out) >= limit:
                return out
    return out


def _first_group(text: str, pattern: str) -> str | None:
    m = re.search(pattern, text, re.I | re.S)
    return m.group(1) if m else None


def _meta_content(html: str, name: str) -> str:
    m = re.search(
        rf'<meta[^>]+name=["\']{re.escape(name)}["\'][^>]+content=["\']([^"\']+)',
        html,
        re.I,
    )
    return m.group(1) if m else ""


def _meta_property(html: str, prop: str) -> str:
    m = re.search(
        rf'<meta[^>]+property=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']+)',
        html,
        re.I,
    )
    return m.group(1) if m else ""


def _count_tag_words(html: str, tag: str) -> int:
    chunks = re.findall(rf"<{tag}\b[^>]*>([\s\S]*?)</{tag}>", html, re.I)
    words = 0
    for chunk in chunks[:40]:
        plain = re.sub(r"<[^>]+>", " ", chunk)
        words += len(plain.split())
    return words


def _clean_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())
