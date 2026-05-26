"""PDF extraction for Research — pypdf baseline, optional Marker API."""

from __future__ import annotations

import logging
import os
import re
import tempfile
from pathlib import Path

import httpx

from oaao_orchestrator.research.document_schema import ArticleMetadata, digest_body, wrap_standard_markdown
from oaao_orchestrator.research.extract.types import ExtractResult
from oaao_orchestrator.research.naming import arxiv_id_from_url

logger = logging.getLogger(__name__)

_USER_AGENT = "OAAO-Research/1.0 (+https://oaao.ai)"


async def extract_arxiv_pdf(client: httpx.AsyncClient, paper_id_or_url: str) -> ExtractResult | None:
    pid = _paper_id(paper_id_or_url)
    if not pid:
        return None
    pdf_url = f"https://arxiv.org/pdf/{pid}.pdf"
    try:
        r = await client.get(pdf_url, headers={"User-Agent": _USER_AGENT}, follow_redirects=True, timeout=120.0)
        r.raise_for_status()
        data = r.content
    except Exception as exc:  # noqa: BLE001
        logger.debug("arxiv pdf download failed %s: %s", pdf_url, exc)
        return None
    if not data or len(data) < 1024:
        return None
    return await extract_pdf_bytes(
        client,
        data,
        source_url=f"https://arxiv.org/abs/{pid}",
        content_url=pdf_url,
        title_hint=f"arXiv {pid}",
        arxiv_id=pid,
    )


def _paper_id(raw: str) -> str:
    s = (raw or "").strip()
    m = re.search(r"([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)", s, re.I)
    return m.group(1) if m else ""


async def extract_pdf_bytes(
    client: httpx.AsyncClient,
    pdf_bytes: bytes,
    *,
    source_url: str,
    content_url: str,
    title_hint: str = "",
    arxiv_id: str = "",
) -> ExtractResult | None:
    marker = await _marker_markdown(client, pdf_bytes, filename="document.pdf")
    if marker:
        body, title = marker
        kind = "marker_pdf"
    else:
        body = _pypdf_text(pdf_bytes)
        title = title_hint
        kind = "pypdf_pdf"
    if not body or len(body.strip()) < 200:
        return None
    title = (title or title_hint or source_url.rsplit("/", 1)[-1]).strip()
    meta = ArticleMetadata(
        title=title,
        arxiv_id=arxiv_id or arxiv_id_from_url(source_url),
        source_url=source_url,
        content_url=content_url,
        content_kind=kind,
    )
    content_hash = digest_body(body)
    meta.content_hash = content_hash
    markdown = wrap_standard_markdown(meta=meta, body=body)
    return ExtractResult(title=title, body=body, metadata=meta, markdown=markdown, content_hash=content_hash)


def _pypdf_text(pdf_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader  # noqa: PLC0415
        import io

        reader = PdfReader(io.BytesIO(pdf_bytes))
        parts: list[str] = []
        for page in reader.pages:
            tx = page.extract_text()
            if isinstance(tx, str) and tx.strip():
                parts.append(tx.strip())
        return "\n\n".join(parts)
    except Exception as exc:  # noqa: BLE001
        logger.warning("pypdf extract failed: %s", exc)
        return ""


async def _marker_markdown(
    client: httpx.AsyncClient,
    pdf_bytes: bytes,
    *,
    filename: str,
) -> tuple[str, str] | None:
    api = (os.environ.get("OAAO_MARKER_API_URL") or os.environ.get("OAAO_RESEARCH_MARKER_URL") or "").strip()
    if not api:
        return None
    key = (os.environ.get("OAAO_MARKER_API_KEY") or "").strip()
    headers = {"User-Agent": _USER_AGENT}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    try:
        r = await client.post(
            api.rstrip("/") + ("" if api.endswith("/markdown") else "/markdown"),
            files={"file": (filename, pdf_bytes, "application/pdf")},
            headers=headers,
            timeout=300.0,
        )
        r.raise_for_status()
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else None
        if isinstance(data, dict):
            md = str(data.get("markdown") or data.get("text") or "").strip()
            title = str(data.get("title") or "").strip()
            if md:
                return md, title
        text = (r.text or "").strip()
        if text.startswith("#") or len(text) > 200:
            return text, ""
    except Exception as exc:  # noqa: BLE001
        logger.warning("marker api failed: %s", exc)
    return None


async def extract_pdf_file(client: httpx.AsyncClient, path: Path, *, source_url: str) -> ExtractResult | None:
    try:
        data = path.read_bytes()
    except OSError as exc:
        logger.warning("read pdf failed %s: %s", path, exc)
        return None
    return await extract_pdf_bytes(
        client,
        data,
        source_url=source_url,
        content_url=source_url,
        title_hint=path.stem,
    )
