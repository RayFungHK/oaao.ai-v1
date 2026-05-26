"""Score outbound links for article vs hub vs noise — structure-aware heuristics."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from oaao_orchestrator.page_router.features import is_nav_link

_ARTICLE_PATH_RE = re.compile(
    r"(/abs/|/pdf/|/html/|/article/|/articles/|/post/|/posts/|/blog/|/entry/|/p/|/story/|/paper/|/doc/)",
    re.I,
)
_DATE_PATH_RE = re.compile(r"/(20\d{2}|19\d{2})[./-](0[1-9]|1[0-2])", re.I)
_PAGINATION_RE = re.compile(r"(page=\d+|/page/\d+|/p/\d+$|\?p=\d+)", re.I)
_ARXIV_ID_RE = re.compile(r"arxiv\.org/(abs|html|pdf)/[0-9]{4}\.[0-9]{4,5}", re.I)
_SLUG_RE = re.compile(r"/[a-z0-9][a-z0-9-]{8,}(?:/|$)", re.I)
_ARXIV_ID_EXTRACT = re.compile(r"([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)", re.I)
_NOISE_ANCHORS = frozenset(
    {
        "html",
        "pdf",
        "ps",
        "abs",
        "doi",
        "src",
        "view",
        "link",
        "here",
        "more",
        "download",
        "full text",
        "full",
        "read",
        "open",
        "go",
    }
)


def link_display_title(url: str, anchor: str = "") -> str:
    """Human-readable label — avoid useless anchors like 'html' / 'pdf'."""
    a = re.sub(r"\s+", " ", (anchor or "").strip())
    u = (url or "").strip()
    if not u:
        return a or "—"

    low = a.lower()
    if not a or low in _NOISE_ANCHORS or (len(a) <= 4 and a.isalpha()):
        m = _ARXIV_ID_EXTRACT.search(u)
        if m:
            return f"arXiv {m.group(1)}"
        parsed = urlparse(u)
        seg = (parsed.path or "").rstrip("/").split("/")[-1]
        if seg and len(seg) > 2:
            return seg.replace("-", " ").replace("_", " ")[:160]
        host = parsed.netloc.replace("www.", "")
        return f"{host}{parsed.path[:80]}" if parsed.path and parsed.path != "/" else u

    return a[:160]


def link_kind_label(url: str) -> str:
    u = (url or "").lower()
    if "/pdf" in u or u.endswith(".pdf"):
        return "pdf"
    if "/html" in u or u.endswith(".html"):
        return "html"
    if "arxiv.org/abs/" in u:
        return "abs"
    if _ARTICLE_PATH_RE.search(u):
        return "article"
    return "link"


def _is_format_sidecar_link(url: str, anchor: str) -> bool:
    """Drop arXiv html/pdf side links when anchor is just a format label."""
    u = (url or "").lower()
    a = (anchor or "").strip().lower()
    if a in {"html", "pdf", "ps"} and ("arxiv.org/html/" in u or "arxiv.org/pdf/" in u):
        return True
    return False


def _main_content_html(html: str) -> str:
    """Prefer links inside main/article/content regions — fallback to full page."""
    text = html.replace("\r", "")
    best = ""
    for tag in ("article", "main"):
        for m in re.finditer(rf"<{tag}\b[^>]*>([\s\S]*?)</{tag}>", text, re.I):
            chunk = m.group(1)
            if len(chunk) > len(best):
                best = chunk
    if len(best) >= 400:
        return best

    for pat in (
        r'id=["\']content["\'][^>]*>([\s\S]{400,}?)</div>',
        r'class=["\'][^"\']*\b(entry-content|post-content|article-body|paper-content|ltx_page_content)\b[^"\']*["\'][^>]*>([\s\S]{400,}?)</div>',
    ):
        for m in re.finditer(pat, text, re.I):
            chunk = m.group(m.lastindex or 1)
            if len(chunk) > len(best):
                best = chunk
    return best if len(best) >= 400 else text


def _link_in_region(href: str, region_html: str, full_html: str) -> bool:
    if region_html is full_html:
        return True
    esc = re.escape(href.split("#")[0])
    return bool(re.search(esc, region_html, re.I))


def score_link_as_article(
    *,
    url: str,
    anchor: str,
    page_url: str,
    region_html: str,
    full_html: str,
) -> dict[str, Any]:
    """Return article_score 0..1, suggested action, and short reason tokens."""
    u = (url or "").strip().split("#")[0].rstrip("/")
    a = (anchor or "").strip()
    score = 0.12
    reasons: list[str] = []

    if is_nav_link(u, a):
        score -= 0.45
        reasons.append("nav")

    if _PAGINATION_RE.search(u):
        score -= 0.35
        reasons.append("pagination")

    parsed = urlparse(u)
    page_host = urlparse(page_url).netloc.lower()
    same_domain = parsed.netloc.lower() == page_host
    if same_domain:
        score += 0.08
    else:
        score -= 0.05

    depth = len([p for p in (parsed.path or "").split("/") if p])
    if depth >= 2:
        score += 0.1
        reasons.append("deep-url")
    elif depth <= 1 and same_domain:
        score -= 0.08
        reasons.append("shallow")

    if _ARXIV_ID_RE.search(u):
        score += 0.42
        reasons.append("arxiv-paper")
    elif _ARTICLE_PATH_RE.search(u):
        score += 0.28
        reasons.append("article-path")
    elif _DATE_PATH_RE.search(u):
        score += 0.18
        reasons.append("dated-path")
    elif _SLUG_RE.search(parsed.path or ""):
        score += 0.12
        reasons.append("slug-path")

    anchor_words = len(re.findall(r"\w+", a, flags=re.UNICODE))
    if anchor_words >= 6:
        score += 0.15
        reasons.append("long-anchor")
    elif anchor_words <= 2 and len(a) <= 12:
        score -= 0.08
        reasons.append("short-anchor")

    if _link_in_region(u, region_html, full_html):
        score += 0.22
        reasons.append("main-region")

    score = max(0.0, min(1.0, score))

    if score >= 0.62:
        action = "fetch"
    elif score >= 0.38:
        action = "maybe"
    elif depth <= 1 and same_domain and anchor_words <= 3:
        action = "drill"
    else:
        action = "skip"

    return {
        "url": u,
        "anchor": a[:160],
        "article_score": round(score, 3),
        "action": action,
        "reasons": reasons,
    }


def score_page_links(
    html: str,
    page_url: str,
    links: list[dict[str, Any]],
    *,
    limit: int = 60,
) -> list[dict[str, Any]]:
    region = _main_content_html(html)
    scored: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ln in links:
        if not isinstance(ln, dict):
            continue
        href = str(ln.get("url") or "").strip()
        if not href or href in seen:
            continue
        seen.add(href)
        anchor = str(ln.get("anchor") or ln.get("title") or "")
        if _is_format_sidecar_link(href, anchor):
            continue
        row = score_link_as_article(
            url=href,
            anchor=anchor,
            page_url=page_url,
            region_html=region,
            full_html=html,
        )
        display = link_display_title(href, anchor)
        row["title"] = display
        row["display_title"] = display
        row["link_kind"] = link_kind_label(href)
        scored.append(row)

    scored.sort(key=lambda r: float(r.get("article_score") or 0), reverse=True)
    return scored[:limit]


def infer_item_url_pattern(urls: list[str]) -> str | None:
    """Infer a regex for index link filtering from user-confirmed article URLs."""
    clean = [u.strip().split("#")[0] for u in urls if str(u).strip()]
    if not clean:
        return None
    if all(_ARXIV_ID_RE.search(u) for u in clean):
        return r"arxiv\.org/(abs|html)/[0-9]{4}\.[0-9]{4,5}"
    paths = [urlparse(u).path for u in clean]
    segs = [[p for p in path.split("/") if p] for path in paths]
    if not segs:
        return None
    min_len = min(len(s) for s in segs)
    prefix: list[str] = []
    for i in range(min_len):
        part = segs[0][i]
        if all(len(s) > i and s[i] == part for s in segs):
            prefix.append(re.escape(part))
        else:
            break
    if len(prefix) >= 2:
        return "/" + "/".join(prefix) + r"/[^/?#]+"
    if all(_ARTICLE_PATH_RE.search(u) for u in clean):
        return r"/(abs|article|articles|post|posts|blog|entry|p|story|paper|html)/"
    return None
