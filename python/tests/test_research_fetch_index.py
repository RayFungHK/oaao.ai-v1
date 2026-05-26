"""Research index / arXiv list link discovery."""

from oaao_orchestrator.research.fetch import _extract_arxiv_abs_urls

SAMPLE_ARXIV_LIST_SNIPPET = """
<dt>[1]</dt>
<dd><a href="https://arxiv.org/abs/2605.23904">arXiv:2605.23904</a></dd>
<dt>[2]</dt>
<dd><a href="/abs/2605.23899">arXiv:2605.23899</a></dd>
<p>See also arXiv:2605.23904 duplicate</p>
"""


def test_extract_arxiv_abs_urls_dedupes_and_normalizes():
    urls = _extract_arxiv_abs_urls(SAMPLE_ARXIV_LIST_SNIPPET, limit=10)
    assert urls == [
        "https://arxiv.org/abs/2605.23904",
        "https://arxiv.org/abs/2605.23899",
    ]


def test_extract_arxiv_abs_urls_respects_limit():
    html = "\n".join(
        f'<a href="https://arxiv.org/abs/2605.{10000 + i:05d}">x</a>' for i in range(20)
    )
    urls = _extract_arxiv_abs_urls(html, limit=3)
    assert len(urls) == 3
