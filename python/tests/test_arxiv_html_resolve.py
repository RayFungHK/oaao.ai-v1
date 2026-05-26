"""arXiv /abs/ → HTML (experimental) content resolution."""

from __future__ import annotations

from oaao_orchestrator.research.fetch import (
    _extract_arxiv_html_urls,
    resolve_arxiv_content_preview,
)

SAMPLE_ABS_HTML = """
<a class="mobile-submission-download" href="https://arxiv.org/html/2605.23899v1">HTML (experimental)</a>
<a href="https://arxiv.org/html/2605.23899v1" class="abs-button" id="latexml-download-link">HTML (experimental)</a>
<a href="/pdf/2605.23899">View PDF</a>
"""


def test_extract_arxiv_html_urls_from_abs_page() -> None:
    urls = _extract_arxiv_html_urls(SAMPLE_ABS_HTML, paper_id="2605.23899")
    assert "https://ar5iv.org/html/2605.23899v1" in urls
    assert "https://arxiv.org/html/2605.23899v1" in urls
    assert urls[0] == "https://ar5iv.org/html/2605.23899v1"


def test_resolve_arxiv_content_preview() -> None:
    meta = resolve_arxiv_content_preview(SAMPLE_ABS_HTML, "https://arxiv.org/abs/2605.23899")
    assert meta["content_kind"] == "ar5iv_html"
    assert meta["content_url"] == "https://ar5iv.org/html/2605.23899v1"


def test_extract_arxiv_html_urls_fallback_by_id() -> None:
    urls = _extract_arxiv_html_urls("<html></html>", paper_id="2605.23899")
    assert "https://arxiv.org/html/2605.23899" in urls
    assert "https://arxiv.org/html/2605.23899v1" in urls
