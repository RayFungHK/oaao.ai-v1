"""Fetch article candidates from RSS, URL, blog, arXiv."""

from __future__ import annotations

import hashlib
import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse

import httpx

logger = logging.getLogger(__name__)

_USER_AGENT = "OAAO-Research/1.0 (+https://oaao.ai)"


@dataclass
class ArticleCandidate:
    url: str
    title: str = ""


@dataclass
class SourcePlanResult:
    candidates: list[ArticleCandidate] = field(default_factory=list)
    index_unchanged: bool = False
    index_html_hash: str | None = None
    state_patch: dict[str, Any] = field(default_factory=dict)


def index_html_hash(html: str) -> str:
    return hashlib.sha256(html[:50000].encode("utf-8", errors="replace")).hexdigest()


def _norm_url(url: str) -> str:
    u = (url or "").strip()
    if u.endswith("/"):
        u = u.rstrip("/")
    return u


def _arxiv_abs_url(raw: str) -> str | None:
    s = (raw or "").strip()
    m = re.search(r"arxiv\.org/(?:abs|pdf)/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)", s, re.I)
    if m:
        return f"https://arxiv.org/abs/{m.group(1)}"
    m2 = re.search(r"^([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)$", s)
    if m2:
        return f"https://arxiv.org/abs/{m2.group(1)}"
    return None


def _arxiv_paper_id(raw: str) -> str | None:
    s = (raw or "").strip()
    m = re.search(
        r"(?:arxiv\.org/(?:abs|pdf|html)|ar5iv\.org/html)/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)",
        s,
        re.I,
    )
    if m:
        return m.group(1)
    m2 = re.search(r"^([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)$", s)
    if m2:
        return m2.group(1)
    return None


def _arxiv_html_url_from_id(paper_id: str) -> str:
    return f"https://arxiv.org/html/{paper_id}"


def _extract_arxiv_html_urls(abs_html: str, *, paper_id: str | None = None) -> list[str]:
    """Resolve arXiv HTML (experimental) URLs from an /abs/ page (or synthesize candidates)."""
    seen: set[str] = set()
    out: list[str] = []

    def _add(raw: str) -> None:
        u = (raw or "").strip()
        if not u:
            return
        if u.startswith("/"):
            u = f"https://arxiv.org{u}"
        low = u.lower()
        if "arxiv.org/html/" not in low and "ar5iv.org/html/" not in low:
            return
        u = _norm_url(u)
        if u in seen:
            return
        seen.add(u)
        out.append(u)

    for m in re.finditer(
        r'id=["\']latexml-download-link["\'][^>]*href=["\']([^"\']+)["\']',
        abs_html,
        re.I | re.S,
    ):
        _add(m.group(1))
    for m in re.finditer(
        r'href=["\']([^"\']+)["\'][^>]*>\s*HTML\s*\(experimental\)',
        abs_html,
        re.I | re.S,
    ):
        _add(m.group(1))
    for m in re.finditer(r"arxiv\.org/html/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)", abs_html, re.I):
        aid = m.group(1)
        _add(f"https://ar5iv.org/html/{aid}")
        _add(f"https://arxiv.org/html/{aid}")

    pid = (paper_id or "").strip()
    if pid:
        base = re.sub(r"v\d+$", "", pid, flags=re.I)
        for suffix in (pid, f"{base}v1" if base else "", base):
            if suffix:
                _add(f"https://ar5iv.org/html/{suffix}")
                _add(_arxiv_html_url_from_id(suffix))

    ar5iv = [u for u in out if "ar5iv.org" in u.lower()]
    other = [u for u in out if "ar5iv.org" not in u.lower()]
    return ar5iv + other


def _body_word_count(text: str) -> int:
    return len(re.findall(r"\w+", text or "", flags=re.UNICODE))


def _is_arxiv_latexml_html(html: str) -> bool:
    sample = (html or "")[:120000].lower()
    return "ltx_document" in sample or "ltx_page_content" in sample


async def _fetch_html(client: httpx.AsyncClient, url: str) -> str:
    r = await client.get(
        url, headers={"User-Agent": _USER_AGENT}, follow_redirects=True, timeout=45.0
    )
    r.raise_for_status()
    return r.text


def _html_to_text(html: str, *, content_url: str | None = None) -> tuple[str, str]:
    title = ""
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I | re.S)
    if m:
        title = re.sub(r"\s+", " ", m.group(1)).strip()

    use_arxiv_html = (
        (content_url or "").lower().find("arxiv.org/html/") >= 0
        or (content_url or "").lower().find("ar5iv.org/html/") >= 0
        or _is_arxiv_latexml_html(html)
    )
    if use_arxiv_html:
        try:
            from oaao_orchestrator.research.arxiv_html_md import (
                arxiv_html_to_markdown,
            )

            converted = arxiv_html_to_markdown(html)
            if converted and _body_word_count(converted) >= 120:
                return title, converted
        except Exception as exc:  # noqa: BLE001
            logger.debug("arxiv html markdown conversion failed: %s", exc)

    try:
        import trafilatura

        extracted = trafilatura.extract(
            html, include_comments=False, include_tables=True, output_format="markdown"
        )
        if extracted and extracted.strip():
            return title, extracted.strip()
    except Exception as exc:  # noqa: BLE001
        logger.debug("trafilatura unavailable or failed: %s", exc)

    body = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    body = re.sub(r"(?is)<br\s*/?>", "\n", body)
    body = re.sub(r"(?is)</p>", "\n\n", body)
    body = re.sub(r"<[^>]+>", " ", body)
    body = re.sub(r"\s+\n", "\n", body)
    body = re.sub(r"[ \t]{2,}", " ", body).strip()
    return title, body


async def extract_article(client: httpx.AsyncClient, url: str) -> tuple[str, str, str]:
    from oaao_orchestrator.research.extract.dispatcher import extract_document

    result = await extract_document(client, url)
    return result.title, result.markdown, result.content_hash


async def fetch_arxiv_markdown(client: httpx.AsyncClient, abs_url: str) -> tuple[str, str, str]:
    from oaao_orchestrator.research.extract.arxiv_backend import extract_arxiv

    result = await extract_arxiv(client, abs_url)
    return result.title, result.markdown, result.content_hash


def resolve_arxiv_content_preview(abs_html: str, abs_url: str) -> dict[str, str]:
    """Discover helper — where full text will be fetched for an /abs/ page."""
    paper_id = _arxiv_paper_id(abs_url)
    html_urls = _extract_arxiv_html_urls(abs_html, paper_id=paper_id)
    if html_urls:
        first = html_urls[0]
        if "ar5iv.org" in first.lower():
            kind = "ar5iv_html"
            hint = "Full text from ar5iv.org HTML (LaTeX)"
        else:
            kind = "arxiv_html_experimental"
            hint = "Full text from arXiv HTML (experimental)"
        return {
            "content_kind": kind,
            "content_url": first,
            "content_hint": hint,
        }
    return {
        "content_kind": "arxiv_abs",
        "content_url": _arxiv_abs_url(abs_url) or abs_url,
        "content_hint": "Abstract/metadata from arXiv /abs/ (no HTML link found)",
    }


def _resolve_source_kind(kind: str, config: dict[str, Any]) -> str:
    k = (kind or "url").strip().lower()
    if k not in ("auto", ""):
        if k == "url":
            dm = str(config.get("discovered_mode") or config.get("source_mode") or "").lower()
            if dm in ("index", "list"):
                return "index"
            if dm == "rss":
                return "rss"
            if dm == "static":
                return "static"
        return k
    dm = str(config.get("discovered_mode") or config.get("source_mode") or "").lower()
    if dm in ("index", "list"):
        return "index"
    if dm == "rss":
        return "rss"
    try:
        from oaao_orchestrator.page_router.classify import classify_page_rules

        ruled = classify_page_rules(str(config.get("url") or ""))
        if ruled and ruled.get("page_type") == "rss":
            return "rss"
        if ruled and ruled.get("page_type") == "index":
            return "index"
        if ruled and ruled.get("page_type") == "article":
            return "static"
    except Exception:  # noqa: BLE001
        pass
    return "static"


async def list_candidates_from_source(
    client: httpx.AsyncClient,
    *,
    kind: str,
    config: dict[str, Any],
) -> list[ArticleCandidate]:
    k = (kind or "url").strip().lower()
    url = str(config.get("url") or "").strip()
    if not url:
        return []

    k = _resolve_source_kind(k, config)

    if k in ("index", "list", "url_list"):
        return await _candidates_index_page(client, url, config)
    if k == "rss":
        return await _candidates_rss(client, url)
    if k == "arxiv":
        abs_url = _arxiv_abs_url(url)
        if abs_url:
            return [ArticleCandidate(url=abs_url, title=f"arXiv {abs_url.rsplit('/', 1)[-1]}")]
        if "arxiv.org/list" in url.lower():
            return await _candidates_arxiv_list(client, url)
        return []
    if k in ("static", "url", "blog"):
        if "arxiv.org/list" in url.lower():
            return await _candidates_arxiv_list(client, url)
        return [ArticleCandidate(url=url, title="")]
    return [ArticleCandidate(url=url, title="")]


_ARXIV_ABS_RE = re.compile(
    r"arxiv\.org/abs/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)",
    re.I,
)
_ARXIV_ID_RE = re.compile(
    r"arxiv:([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)",
    re.I,
)


def _extract_arxiv_abs_urls(html: str, *, limit: int = 50) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for pat in (_ARXIV_ABS_RE, _ARXIV_ID_RE):
        for m in pat.finditer(html):
            aid = m.group(1)
            abs_url = f"https://arxiv.org/abs/{aid}"
            if abs_url in seen:
                continue
            seen.add(abs_url)
            out.append(abs_url)
            if len(out) >= limit:
                return out
    return out


async def _candidates_arxiv_list(
    client: httpx.AsyncClient, list_url: str
) -> list[ArticleCandidate]:
    html = await _fetch_html(client, list_url)
    urls = _extract_arxiv_abs_urls(html)
    return [ArticleCandidate(url=u, title=f"arXiv {u.rsplit('/', 1)[-1]}") for u in urls]


async def _candidates_index_page(
    client: httpx.AsyncClient,
    page_url: str,
    config: dict[str, Any],
) -> list[ArticleCandidate]:
    if "arxiv.org/list" in page_url.lower():
        return await _candidates_arxiv_list(client, page_url)

    html = await _fetch_html(client, page_url)
    return await _candidates_index_page_from_html(client, page_url, html, config)


async def _candidates_rss(client: httpx.AsyncClient, feed_url: str) -> list[ArticleCandidate]:
    try:
        import feedparser

        r = await client.get(
            feed_url, headers={"User-Agent": _USER_AGENT}, follow_redirects=True, timeout=45.0
        )
        r.raise_for_status()
        parsed = feedparser.parse(r.content)
        out: list[ArticleCandidate] = []
        for entry in parsed.entries[:40]:
            link = str(getattr(entry, "link", "") or "").strip()
            if not link:
                continue
            title = str(getattr(entry, "title", "") or "").strip()
            out.append(ArticleCandidate(url=_norm_url(link), title=title))
        return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("rss parse failed %s: %s", feed_url, exc)

    try:
        r = await client.get(
            feed_url, headers={"User-Agent": _USER_AGENT}, follow_redirects=True, timeout=45.0
        )
        r.raise_for_status()
        root = ET.fromstring(r.content)
        out = []
        for item in root.iter():
            if not item.tag.lower().endswith("item") and not item.tag.lower().endswith("entry"):
                continue
            link = ""
            title = ""
            for child in item:
                tag = child.tag.lower()
                if tag.endswith("link") and child.text:
                    link = child.text.strip()
                if tag.endswith("title") and child.text:
                    title = child.text.strip()
                if tag.endswith("link") and child.attrib.get("href"):
                    link = child.attrib["href"].strip()
            if link:
                out.append(ArticleCandidate(url=_norm_url(urljoin(feed_url, link)), title=title))
            if len(out) >= 40:
                break
        return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("rss xml fallback failed %s: %s", feed_url, exc)
        return []


def _entry_within_days(entry: Any, max_days: int) -> bool:
    if max_days < 1:
        return True
    published = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if not published:
        return True
    try:
        dt = datetime(*published[:6], tzinfo=UTC)
        return dt >= datetime.now(UTC) - timedelta(days=max_days)
    except Exception:  # noqa: BLE001
        return True


async def _candidates_rss_filtered(
    client: httpx.AsyncClient,
    feed_url: str,
    *,
    max_days: int | None,
) -> list[ArticleCandidate]:
    cands = await _candidates_rss(client, feed_url)
    if max_days is None or max_days < 1:
        return cands
    try:
        import feedparser

        r = await client.get(
            feed_url, headers={"User-Agent": _USER_AGENT}, follow_redirects=True, timeout=45.0
        )
        r.raise_for_status()
        parsed = feedparser.parse(r.content)
        out: list[ArticleCandidate] = []
        for entry in parsed.entries[:80]:
            if not _entry_within_days(entry, max_days):
                continue
            link = str(getattr(entry, "link", "") or "").strip()
            if not link:
                continue
            title = str(getattr(entry, "title", "") or "").strip()
            out.append(ArticleCandidate(url=_norm_url(link), title=title))
        return out or cands
    except Exception:  # noqa: BLE001
        return cands


def _arxiv_skip_from_url(url: str) -> int:
    q = parse_qs(urlparse(url).query)
    raw = (q.get("skip") or ["0"])[0]
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


def _arxiv_url_with_skip(base_url: str, skip: int) -> str:
    parsed = urlparse(base_url)
    q = parse_qs(parsed.query)
    q["skip"] = [str(max(0, skip))]
    if "show" not in q:
        q["show"] = ["50"]
    new_query = urlencode({k: v[0] for k, v in q.items()})
    return urlunparse(parsed._replace(query=new_query))


def _next_backfill_page_url(page_url: str, config: dict[str, Any]) -> str | None:
    cursor = config.get("backfill_cursor")
    if not isinstance(cursor, dict):
        cursor = {}
    if "arxiv.org/list" in page_url.lower():
        current_skip = int(cursor.get("skip") or _arxiv_skip_from_url(page_url))
        next_skip = current_skip + int(cursor.get("page_size") or 50)
        return _arxiv_url_with_skip(str(cursor.get("page_url") or page_url), next_skip)
    next_url = str(cursor.get("next_page_url") or "").strip()
    return next_url or None


async def plan_source_candidates(
    client: httpx.AsyncClient,
    *,
    kind: str,
    config: dict[str, Any],
    watch_config: dict[str, Any],
    force_refetch: bool = False,
) -> SourcePlanResult:
    k = _resolve_source_kind(kind, config)
    page_url = str(config.get("url") or "").strip()
    backfill = bool(watch_config.get("backfill_enabled"))
    max_days = int(watch_config.get("backfill_max_days") or 30)

    if k == "rss":
        days = max_days if backfill else None
        return SourcePlanResult(
            candidates=await _candidates_rss_filtered(client, page_url, max_days=days)
        )

    if k in ("static", "url", "blog"):
        if "arxiv.org/list" in page_url.lower():
            k = "index"
        else:
            return SourcePlanResult(
                candidates=await list_candidates_from_source(client, kind=kind, config=config),
            )

    if k == "arxiv":
        return SourcePlanResult(
            candidates=await list_candidates_from_source(client, kind=kind, config=config),
        )

    if k not in ("index", "list", "url_list"):
        return SourcePlanResult(
            candidates=await list_candidates_from_source(client, kind=kind, config=config),
        )

    fetch_url = page_url
    cursor = config.get("backfill_cursor")
    if backfill and isinstance(cursor, dict):
        cursor_url = str(cursor.get("page_url") or "").strip()
        if cursor_url:
            fetch_url = cursor_url

    html = await _fetch_html(client, fetch_url)
    html_hash = index_html_hash(html)
    last_hash = str(config.get("last_index_hash") or "").strip()

    if last_hash and html_hash == last_hash and not backfill and not force_refetch:
        return SourcePlanResult(candidates=[], index_unchanged=True, index_html_hash=html_hash)

    if last_hash and html_hash == last_hash and backfill and not force_refetch:
        next_url = _next_backfill_page_url(page_url, config)
        if not next_url or next_url == fetch_url:
            return SourcePlanResult(candidates=[], index_unchanged=True, index_html_hash=html_hash)
        fetch_url = next_url
        html = await _fetch_html(client, fetch_url)
        html_hash = index_html_hash(html)

    candidates = await _candidates_index_page_from_html(client, fetch_url, html, config)
    if backfill and max_days > 0:
        candidates = candidates[
            : int(config.get("max_items") or config.get("max_items_per_run") or 50)
        ]

    state_patch: dict[str, Any] = {
        "last_fetched_at": datetime.now(UTC).isoformat(),
    }
    if fetch_url == page_url:
        state_patch["last_index_hash"] = html_hash
    if backfill:
        if "arxiv.org/list" in page_url.lower():
            state_patch["backfill_cursor"] = {
                "page_url": page_url,
                "skip": _arxiv_skip_from_url(fetch_url),
                "page_size": 50,
                "last_page_url": fetch_url,
            }
        else:
            state_patch["backfill_cursor"] = {
                "page_url": page_url,
                "last_page_url": fetch_url,
            }

    return SourcePlanResult(
        candidates=candidates,
        index_html_hash=html_hash if fetch_url == page_url else last_hash or html_hash,
        state_patch=state_patch,
    )


async def _candidates_index_page_from_html(
    client: httpx.AsyncClient,
    page_url: str,
    html: str,
    config: dict[str, Any],
) -> list[ArticleCandidate]:
    if "arxiv.org/list" in page_url.lower():
        urls = _extract_arxiv_abs_urls(html)
        return [ArticleCandidate(url=u, title=f"arXiv {u.rsplit('/', 1)[-1]}") for u in urls]

    pattern = str(config.get("item_url_pattern") or config.get("link_pattern") or "").strip()
    if not pattern:
        samples = config.get("confirmed_sample_urls")
        if isinstance(samples, list) and samples:
            from oaao_orchestrator.page_router.link_scoring import (
                infer_item_url_pattern,
            )

            pattern = infer_item_url_pattern([str(u) for u in samples if str(u).strip()]) or ""
    limit = int(config.get("max_items") or config.get("max_items_per_run") or 50)
    if limit < 1:
        limit = 50

    if pattern:
        try:
            rx = re.compile(pattern, re.I)
        except re.error:
            rx = None
    else:
        rx = None

    seen: set[str] = set()
    out: list[ArticleCandidate] = []
    for m in re.finditer(r'href=["\']([^"\']+)["\']', html, re.I):
        href = m.group(1).strip()
        if not href or href.startswith("#") or href.lower().startswith("javascript:"):
            continue
        full = _norm_url(urljoin(page_url, href))
        if full in seen:
            continue
        if rx and not rx.search(full):
            continue
        if not rx and page_url.split("/")[2] not in full:
            continue
        seen.add(full)
        title = full.rsplit("/", 1)[-1] or full
        out.append(ArticleCandidate(url=full, title=title))
        if len(out) >= limit:
            break
    return out
