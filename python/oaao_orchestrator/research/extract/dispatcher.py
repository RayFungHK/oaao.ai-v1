"""Research Source Dispatcher — route URL to arXiv / web / PDF backends."""

from __future__ import annotations

import httpx

from oaao_orchestrator.research.document_schema import (
    ArticleMetadata,
    digest_body,
    wrap_standard_markdown,
)
from oaao_orchestrator.research.extract.arxiv_backend import extract_arxiv
from oaao_orchestrator.research.extract.types import ExtractResult
from oaao_orchestrator.research.extract.web_backend import fetch_html, html_to_markdown
from oaao_orchestrator.research.naming import resolve_article_title


def _norm_url(url: str) -> str:
    u = (url or "").strip()
    return u.rstrip("/") if u.endswith("/") else u


def detect_source_kind(url: str) -> str:
    low = (url or "").lower()
    if "arxiv.org" in low or "ar5iv.org" in low:
        return "arxiv"
    if low.endswith(".pdf") or "/pdf/" in low:
        return "pdf"
    return "web"


async def extract_document(
    client: httpx.AsyncClient,
    url: str,
    *,
    title_hint: str = "",
) -> ExtractResult:
    canonical = _norm_url(url)
    kind = detect_source_kind(canonical)

    if kind == "arxiv":
        return await extract_arxiv(client, canonical, title_hint=title_hint)

    if kind == "pdf":
        from oaao_orchestrator.research.extract.pdf_backend import (
            extract_pdf_bytes,
        )

        r = await client.get(canonical, follow_redirects=True, timeout=120.0)
        r.raise_for_status()
        result = await extract_pdf_bytes(
            client,
            r.content,
            source_url=canonical,
            content_url=canonical,
            title_hint=title_hint,
        )
        if result:
            return result

    html = await fetch_html(client, canonical)
    title, body, content_kind = await html_to_markdown(client, canonical, html)
    if not body:
        body = html[:120000]
    title = resolve_article_title(title, title_hint=title_hint, url=canonical, markdown=body)
    meta = ArticleMetadata(
        title=title,
        source_url=canonical,
        content_url=canonical,
        content_kind=content_kind,
    )
    content_hash = digest_body(body)
    meta.content_hash = content_hash
    markdown = wrap_standard_markdown(meta=meta, body=body)
    return ExtractResult(
        title=title, body=body, metadata=meta, markdown=markdown, content_hash=content_hash
    )
