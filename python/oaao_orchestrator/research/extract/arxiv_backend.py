"""arXiv / ar5iv full-text extraction with HTML → PDF fallback chain."""

from __future__ import annotations

import logging
import re

import httpx

from oaao_orchestrator.research.document_schema import (
    ArticleMetadata,
    digest_body,
    wrap_standard_markdown,
)
from oaao_orchestrator.research.extract.types import ExtractResult
from oaao_orchestrator.research.extract.web_backend import fetch_html, html_to_markdown
from oaao_orchestrator.research.naming import arxiv_id_from_url, resolve_article_title

logger = logging.getLogger(__name__)


def arxiv_abs_url(raw: str) -> str | None:
    s = (raw or "").strip()
    m = re.search(r"arxiv\.org/(?:abs|pdf)/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)", s, re.I)
    if m:
        return f"https://arxiv.org/abs/{m.group(1)}"
    m2 = re.search(r"^([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)$", s)
    if m2:
        return f"https://arxiv.org/abs/{m2.group(1)}"
    return None


def arxiv_paper_id(raw: str) -> str | None:
    s = (raw or "").strip()
    for pat in (
        r"arxiv\.org/(?:abs|pdf|html)/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)",
        r"ar5iv\.org/html/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)",
    ):
        m = re.search(pat, s, re.I)
        if m:
            return m.group(1)
    m2 = re.search(r"^([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)$", s)
    return m2.group(1) if m2 else None


def arxiv_html_url_candidates(paper_id: str, *, abs_html: str = "") -> list[str]:
    """Preferred order: ar5iv → arxiv.org/html (from abs links + synthesized)."""
    seen: set[str] = set()
    out: list[str] = []

    def _add(raw: str) -> None:
        u = (raw or "").strip().rstrip("/")
        if not u or u in seen:
            return
        seen.add(u)
        out.append(u)

    for host in ("ar5iv.org", "arxiv.org"):
        for m in re.finditer(
            rf"{re.escape(host)}/html/([0-9]{{4}}\.[0-9]{{4,5}}(?:v\d+)?)",
            abs_html or "",
            re.I,
        ):
            _add(f"https://{host}/html/{m.group(1)}")

    pid = (paper_id or "").strip()
    if pid:
        base = re.sub(r"v\d+$", "", pid, flags=re.I)
        for suffix in (pid, f"{base}v1" if base else "", base):
            if not suffix:
                continue
            _add(f"https://ar5iv.org/html/{suffix}")
            _add(f"https://arxiv.org/html/{suffix}")

    return out


def parse_arxiv_abs_metadata(abs_html: str, *, source_url: str, paper_id: str) -> ArticleMetadata:
    title = ""
    m = re.search(r'<h1[^>]*class="[^"]*title[^"]*"[^>]*>(.*?)</h1>', abs_html, re.I | re.S)
    if m:
        title = _strip_tags(m.group(1))
    if not title:
        m2 = re.search(r"<title[^>]*>([^<]+)</title>", abs_html, re.I)
        if m2:
            title = re.sub(r"\s+", " ", m2.group(1)).strip()
            title = re.sub(r"\s*\[.*?\]\s*$", "", title).strip()

    authors: list[str] = []
    for m in re.finditer(
        r'<div[^>]*class="[^"]*authors[^"]*"[^>]*>(.*?)</div>', abs_html, re.I | re.S
    ):
        block = m.group(1)
        for a in re.finditer(r"<a[^>]*>([^<]+)</a>", block, re.I):
            name = _strip_tags(a.group(1))
            if name and name not in authors:
                authors.append(name)
        if authors:
            break

    published_at = ""
    for pat in (
        r'<div[^>]*class="[^"]*dateline[^"]*"[^>]*>(.*?)</div>',
        r"Submitted on\s+([^<\n]+)",
        r"Published:\s*([^<\n]+)",
    ):
        m = re.search(pat, abs_html, re.I | re.S)
        if m:
            published_at = _strip_tags(m.group(1))
            if published_at:
                break

    doi = ""
    dm = re.search(r"https?://doi\.org/([^\s\"'<>]+)", abs_html, re.I)
    if dm:
        doi = dm.group(1).strip()

    return ArticleMetadata(
        title=title,
        authors=authors,
        published_at=published_at,
        doi=doi,
        arxiv_id=paper_id or arxiv_id_from_url(source_url),
        source_url=source_url,
    )


def _strip_tags(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def _body_word_count(text: str) -> int:
    return len(re.findall(r"\w+", text or "", flags=re.UNICODE))


async def _fetch_html_body_chain(
    client: httpx.AsyncClient,
    html_urls: list[str],
    *,
    abs_title: str,
    abs_body: str,
) -> tuple[str, str, str, str] | None:
    abs_words = _body_word_count(abs_body)
    min_words = max(400, abs_words * 2 + 120)
    for html_url in html_urls:
        try:
            page = await fetch_html(client, html_url)
            title, body, kind = await html_to_markdown(client, html_url, page)
            if _body_word_count(body) >= min_words:
                resolved_title = resolve_article_title(
                    title or abs_title,
                    title_hint=abs_title,
                    url=html_url,
                    markdown=body,
                    fallback=abs_title,
                )
                content_kind = "ar5iv_html" if "ar5iv.org" in html_url.lower() else kind
                return resolved_title, body, html_url, content_kind
        except Exception as exc:  # noqa: BLE001
            logger.debug("arxiv html fetch failed %s: %s", html_url, exc)
    return None


async def extract_arxiv(
    client: httpx.AsyncClient,
    url: str,
    *,
    title_hint: str = "",
) -> ExtractResult:
    canonical_abs = arxiv_abs_url(url) or url.strip().rstrip("/")
    paper_id = arxiv_paper_id(canonical_abs) or arxiv_paper_id(url) or ""
    abs_html = await fetch_html(client, canonical_abs)
    base_meta = parse_arxiv_abs_metadata(abs_html, source_url=canonical_abs, paper_id=paper_id)
    abs_title, abs_body, _ = await html_to_markdown(client, canonical_abs, abs_html)

    html_urls = arxiv_html_url_candidates(paper_id, abs_html=abs_html)
    resolved = await _fetch_html_body_chain(
        client,
        html_urls,
        abs_title=abs_title or base_meta.title,
        abs_body=abs_body,
    )

    if resolved:
        title, body, content_url, content_kind = resolved
    else:
        from oaao_orchestrator.research.extract.pdf_backend import (
            extract_arxiv_pdf,
        )

        pdf_result = await extract_arxiv_pdf(client, paper_id or canonical_abs)
        if pdf_result:
            return pdf_result
        title = resolve_article_title(
            abs_title or base_meta.title,
            title_hint=title_hint or base_meta.title,
            url=canonical_abs,
            markdown=abs_body,
            fallback=base_meta.title,
        )
        body = abs_body or abs_html[:120000]
        content_url = canonical_abs
        content_kind = "arxiv_abs"

    title = resolve_article_title(
        title,
        title_hint=title_hint or base_meta.title,
        url=canonical_abs,
        markdown=body,
        fallback=base_meta.title,
    )
    meta = ArticleMetadata(
        title=title,
        authors=list(base_meta.authors),
        published_at=base_meta.published_at,
        doi=base_meta.doi,
        arxiv_id=paper_id or base_meta.arxiv_id,
        source_url=canonical_abs,
        content_url=content_url if resolved else canonical_abs,
        content_kind=content_kind,
    )
    content_hash = digest_body(body)
    meta.content_hash = content_hash
    markdown = wrap_standard_markdown(meta=meta, body=body)
    return ExtractResult(
        title=title, body=body, metadata=meta, markdown=markdown, content_hash=content_hash
    )
