"""Web article extraction — trafilatura, Jina Reader, Firecrawl."""

from __future__ import annotations

import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

_USER_AGENT = "OAAO-Research/1.0 (+https://oaao.ai)"


def web_extract_backend() -> str:
    return (os.environ.get("OAAO_RESEARCH_EXTRACT_BACKEND") or "trafilatura").strip().lower()


async def fetch_html(client: httpx.AsyncClient, url: str) -> str:
    r = await client.get(
        url, headers={"User-Agent": _USER_AGENT}, follow_redirects=True, timeout=45.0
    )
    r.raise_for_status()
    return r.text


async def html_to_markdown(client: httpx.AsyncClient, url: str, html: str) -> tuple[str, str, str]:
    """Return (title, body, content_kind)."""
    backend = web_extract_backend()
    if backend == "jina":
        out = await _jina_reader(client, url)
        if out:
            return out
    if backend == "firecrawl":
        out = await _firecrawl_scrape(client, url)
        if out:
            return out
    return _trafilatura_html(html, url=url)


def _page_title(html: str) -> str:
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I | re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


def _trafilatura_html(html: str, *, url: str) -> tuple[str, str, str]:
    title = _page_title(html)
    use_arxiv = "ltx_document" in (html or "")[:120000].lower() or "arxiv.org/html/" in url.lower()
    if use_arxiv:
        try:
            from oaao_orchestrator.research.arxiv_html_md import (
                arxiv_html_to_markdown,
            )

            converted = arxiv_html_to_markdown(html)
            if converted and converted.strip():
                return title, converted.strip(), "arxiv_latexml_html"
        except Exception as exc:  # noqa: BLE001
            logger.debug("arxiv html conversion failed: %s", exc)
    try:
        import trafilatura

        extracted = trafilatura.extract(
            html, include_comments=False, include_tables=True, output_format="markdown"
        )
        if extracted and extracted.strip():
            return title or url.rsplit("/", 1)[-1], extracted.strip(), "trafilatura"
    except Exception as exc:  # noqa: BLE001
        logger.debug("trafilatura failed: %s", exc)
    body = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    body = re.sub(r"(?is)<br\s*/?>", "\n", body)
    body = re.sub(r"(?is)</p>", "\n\n", body)
    body = re.sub(r"<[^>]+>", " ", body)
    body = re.sub(r"\s+\n", "\n", body)
    body = re.sub(r"[ \t]{2,}", " ", body).strip()
    return title, body, "html_strip"


async def _jina_reader(client: httpx.AsyncClient, url: str) -> tuple[str, str, str] | None:
    base = (os.environ.get("OAAO_JINA_READER_BASE_URL") or "https://r.jina.ai").rstrip("/")
    token = (os.environ.get("OAAO_JINA_API_KEY") or os.environ.get("JINA_API_KEY") or "").strip()
    headers = {"User-Agent": _USER_AGENT, "Accept": "text/markdown"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        r = await client.get(f"{base}/{url}", headers=headers, follow_redirects=True, timeout=90.0)
        r.raise_for_status()
        body = (r.text or "").strip()
        if not body:
            return None
        title = ""
        for line in body.splitlines()[:20]:
            if line.startswith("# "):
                title = line[2:].strip()
                break
        return title or url.rsplit("/", 1)[-1], body, "jina_reader"
    except Exception as exc:  # noqa: BLE001
        logger.warning("jina reader failed %s: %s", url, exc)
        return None


async def _firecrawl_scrape(client: httpx.AsyncClient, url: str) -> tuple[str, str, str] | None:
    api = (
        os.environ.get("OAAO_FIRECRAWL_API_URL") or "https://api.firecrawl.dev/v1/scrape"
    ).strip()
    key = (
        os.environ.get("OAAO_FIRECRAWL_API_KEY") or os.environ.get("FIRECRAWL_API_KEY") or ""
    ).strip()
    if not key:
        logger.debug("firecrawl skipped — no API key")
        return None
    try:
        r = await client.post(
            api,
            json={"url": url, "formats": ["markdown"]},
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            timeout=120.0,
        )
        r.raise_for_status()
        data = r.json()
        md = ""
        if isinstance(data, dict):
            inner = data.get("data")
            if isinstance(inner, dict):
                md = str(inner.get("markdown") or "").strip()
            if not md:
                md = str(data.get("markdown") or "").strip()
        if not md:
            return None
        title = ""
        for line in md.splitlines()[:20]:
            if line.startswith("# "):
                title = line[2:].strip()
                break
        return title or url.rsplit("/", 1)[-1], md, "firecrawl"
    except Exception as exc:  # noqa: BLE001
        logger.warning("firecrawl failed %s: %s", url, exc)
        return None
